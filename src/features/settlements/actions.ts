'use server'
import { z } from 'zod'
import { financeActive, lockFinance, postMoney } from '@/features/finance/ledger'
import {
  assertAccountAccess,
  assertFinancePermission,
  assertOperationDate,
} from '@/features/finance/access'
import { db } from '@/lib/db'
import { withAuth, type AuthContext } from '@/lib/with-auth'
import { PermissionSubject as S, PermissionAction as A, hasPermission } from '@/lib/permissions'
import { getCachedMembership } from '@/lib/cached-session'
import { revalidatePath } from 'next/cache'
import { settlementsEnabled, withLinks } from './ledger'
import { operationDate, operation, applyOperation } from './operations'
import { dueOn, workshopDay, activeOn, day, hryvnia, isCredit, kopecks, remaining } from './amounts'
import { receiptTotal } from '@/features/receipts/money'

function access<T>(action: A, fn: (ctx: AuthContext) => Promise<T>) {
  return withAuth(
    async (ctx) => {
      if (!settlementsEnabled(ctx.organizationId)) throw new Error('Розрахунки ще не увімкнено.')
      return fn(ctx)
    },
    { requiredPermissions: [{ action, subject: S.SETTLEMENTS }] }
  )
}
export async function settlementAccess() {
  const r = await withAuth(async ({ organizationId, userId, isAdmin }) => {
    const member = await getCachedMembership(userId)
    const can = (action: A) =>
      settlementsEnabled(organizationId) &&
      (isAdmin ||
        hasPermission(member?.customRole?.permissions ?? [], { action, subject: S.SETTLEMENTS }))
    return {
      read: can(A.READ),
      create: can(A.CREATE),
      manage: can(A.MANAGE),
      reverse: can(A.DELETE),
    }
  })
  return r.data ?? { read: false, create: false, manage: false, reverse: false }
}
export async function recordSettlement(supplierId: string, requestId: string, raw: unknown) {
  const data = operation.safeParse(raw)
  if (!data.success || !z.string().uuid().safeParse(requestId).success || !supplierId)
    return { success: false, error: 'Перевірте дату, суму та обов’язкові поля.' }
  const d = data.data
  const action =
    d.op === 'reverse'
      ? A.DELETE
      : ['opening', 'reconcile', 'due'].includes(d.op)
        ? A.MANAGE
        : A.CREATE
  return access(action, async (ctx) => {
    const { organizationId, userId } = ctx
    await db.$transaction(async (tx) => {
      await lockFinance(tx, organizationId)
      const active = await financeActive(tx, organizationId)
      if (
        active &&
        d.op === 'reverse' &&
        d.kind === 'entry' &&
        (await tx.financialDocument.findFirst({ where: { organizationId, supplierEntryId: d.id } }))
      )
        throw new Error(
          'Сторнуйте оплату через розділ кас, щоб одночасно відновити залишок грошей.'
        )
      if (active && d.op === 'payment') {
        await assertFinancePermission(ctx, A.UPDATE)
        if (!d.moneyAccountId) throw new Error('Оберіть рахунок списання.')
        await assertOperationDate(ctx, day(d.date))
        await assertAccountAccess(ctx, [d.moneyAccountId], tx)
      }
      await applyOperation(tx, organizationId, supplierId, userId, requestId, d)
      if (active && d.op === 'payment')
        await postMoney(tx, organizationId, userId, {
          requestId,
          kind: 'supplier_payment',
          date: day(d.date),
          amount: d.amount,
          sourceAccountId: d.moneyAccountId,
          supplierEntryId: requestId,
          note: d.note || 'Оплата постачальнику',
        })
    })
    revalidatePath('/settlements')
    revalidatePath('/receipts')
    return true
  })
}
export async function settlementReport(asOf: string, supplierId?: string) {
  return access(A.READ, async ({ organizationId }) => {
    const cutoff = operationDate.parse(asOf)
    const [suppliers, entries, unknown] = await Promise.all([
      db.counterparty.findMany({
        where: {
          organizationId,
          supplierProfile: { isNot: null },
          ...(supplierId ? { id: supplierId } : {}),
        },
        select: { id: true, name: true, isArchived: true },
        orderBy: { name: 'asc' },
      }),
      db.supplierEntry.findMany({
        where: { organizationId, ...(supplierId ? { supplierId } : {}), date: { lte: cutoff } },
        include: { ...withLinks, termChanges: { orderBy: [{ changedAt: 'asc' }, { id: 'asc' }] } },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      }),
      db.supplierReceipt.findMany({
        where: {
          organizationId,
          ...(supplierId ? { supplierId } : {}),
          OR: [{ status: 'posted' }, { status: 'cancelled' }],
          AND: [{ OR: [{ settlement: null }, { settlement: { date: { gt: cutoff } } }] }],
          receivedDate: { lte: cutoff },
        },
        select: {
          postedAt: true,
          cancelledAt: true,
          id: true,
          supplierId: true,
          number: true,
          lines: { select: { amount: true } },
        },
      }),
    ])
    const actors = await db.user.findMany({
      where: {
        id: {
          in: [
            ...new Set(
              entries
                .flatMap((e) => [
                  e.createdById,
                  e.reversedById,
                  ...[...e.credits, ...e.debits].flatMap((l) => [l.createdById, l.reversedById]),
                ])
                .filter((x): x is string => !!x)
            ),
          ],
        },
      },
      select: { id: true, name: true },
    })
    const names = new Map(actors.map((a) => [a.id, a.name]))
    return suppliers.map((s) => {
      const rows = entries
        .filter((e) => e.supplierId === s.id)
        .map((e) => {
          const links = isCredit(e.kind) ? e.credits : e.debits
          const open = remaining(e, links, asOf)
          const due = dueOn(e.due, e.termChanges, asOf)
          const active = activeOn(e, asOf)
          return {
            id: e.id,
            kind: e.kind,
            date: day(e.date),
            due,
            amount: e.amount.toFixed(2),
            open: hryvnia(open),
            overdue: active && !isCredit(e.kind) && open > 0 && !!due && due < asOf,
            active,
            receiptId: e.receiptId,
            reference: e.reference,
            note: e.note,
            method: e.method,
            createdBy: names.get(e.createdById) ?? e.createdById,
            createdAt: e.createdAt.toISOString(),
            reversedBy: e.reversedById ? (names.get(e.reversedById) ?? e.reversedById) : null,
            reason: active ? null : e.reason,
            links: links
              .filter((l) => day(l.date) <= asOf)
              .map((l) => ({
                id: l.id,
                credit: l.creditId,
                debit: l.debitId,
                amount: l.amount.toFixed(2),
                date: day(l.date),
                active: activeOn(l, asOf),
                createdBy: names.get(l.createdById) ?? l.createdById,
                reason: activeOn(l, asOf) ? null : l.reason,
              })),
          }
        })
      const total = (filter: (r: (typeof rows)[number]) => boolean) =>
        rows.filter(filter).reduce((a, r) => a + kopecks(r.open), BigInt(0))
      const debt = total((r) => !isCredit(r.kind)),
        advance = total((r) => isCredit(r.kind))
      return {
        ...s,
        rows,
        debt: hryvnia(debt),
        advance: hryvnia(advance),
        net: hryvnia(debt - advance),
        overdue: hryvnia(total((r) => r.overdue)),
        unknown: unknown
          .filter(
            (r) =>
              r.supplierId === s.id &&
              !!r.postedAt &&
              workshopDay(r.postedAt) <= asOf &&
              (!r.cancelledAt || workshopDay(r.cancelledAt) > asOf)
          )
          .map((r) => ({ id: r.id, number: r.number, total: receiptTotal(r.lines) })),
      }
    })
  })
}
