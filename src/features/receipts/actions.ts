'use server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { withAuth, type AuthContext } from '@/lib/with-auth'
import { PermissionAction as A, PermissionSubject as S } from '@/lib/permissions'
import { receiptTotal, storedLineAmount } from './money'
import { draftSchema, transitionReceipt } from './ledger'
import { onInventoryChanged } from '@/features/inventory/Lib/onInventoryChanged'

import { settlementAccess } from '@/features/settlements/actions'
import { day, hryvnia, kopecks, remaining, workshopDay } from '@/features/settlements/amounts'
import { getCachedMembership } from '@/lib/cached-session'
import { articleKey, matchArticle } from './articles'
import { receiptsEnabled } from './enabled'
function authorized<T>(action: A | A[], fn: (ctx: AuthContext) => Promise<T>) {
  return withAuth(
    async (ctx) => {
      if (!receiptsEnabled(ctx.organizationId)) throw new Error('Надходження вимкнено.')
      return fn(ctx)
    },
    { requiredPermissions: [action].flat().map((a) => ({ action: a, subject: S.RECEIPTS })) }
  )
}
export async function receiptAccess() {
  const result = await withAuth(async ({ userId, organizationId, isAdmin }) => {
    const member = await getCachedMembership(userId)
    const enabled = receiptsEnabled(organizationId)
    const can = (action: A) =>
      enabled &&
      (isAdmin ||
        !!member?.customRole?.permissions.some(
          (p) => p.subject === S.RECEIPTS && p.action === action
        ))
    return { read: can(A.READ), create: can(A.CREATE), post: can(A.UPDATE), cancel: can(A.DELETE) }
  })
  return result.data ?? { read: false, create: false, post: false, cancel: false }
}
export async function receiptOptions() {
  return authorized(A.CREATE, async ({ organizationId }) => ({
    suppliers: await db.counterparty.findMany({
      where: { organizationId, isArchived: false, supplierProfile: { isNot: null } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    parts: await db.inventoryPart.findMany({
      where: { organizationId, isArchived: false },
      select: {
        id: true,
        name: true,
        supplierArticles: { select: { supplierId: true, normalized: true } },
        partNumber: true,
        barcode: true,
        unit: true,
        brand: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
    }),
  }))
}
export async function receiptList(
  q: string,
  status: string,
  supplierId: string,
  date: string,
  page: number,
  paymentFilter = ''
) {
  return authorized(A.READ, async ({ organizationId }) => {
    const where = {
      organizationId,
      ...(supplierId && { supplierId }),
      ...(date && { receivedDate: new Date(date + 'T00:00:00Z') }),
      ...(status && { status }),
      OR: [
        { number: { contains: q, mode: 'insensitive' as const } },
        { supplier: { name: { contains: q, mode: 'insensitive' as const } } },
      ],
    }
    const visible = (await settlementAccess()).read
    const filter = visible ? paymentFilter : ''
    const rows = await db.supplierReceipt.findMany({
      where,
      include: {
        settlement: { include: { debits: true } },
        supplier: { select: { name: true } },
        lines: { select: { amount: true } },
      },
      orderBy: [{ receivedDate: 'desc' }, { id: 'desc' }],
      ...(filter ? {} : { skip: (page - 1) * 50, take: 51 }),
    })
    const result = rows.map((r) => {
      const entry = visible ? r.settlement : null
      const open = entry ? remaining(entry, entry.debits, workshopDay()) : null
      const total = receiptTotal(r.lines)
      const paid = open === null ? null : kopecks(total) - open
      const state =
        r.status !== 'posted'
          ? ''
          : !entry
            ? 'unverified'
            : open === BigInt(0)
              ? 'paid'
              : paid === BigInt(0)
                ? 'unpaid'
                : 'partial'
      return {
        supplierId: r.supplierId,
        state,
        open: open === null ? null : hryvnia(open),
        paid: paid === null ? null : hryvnia(paid),
        due: entry?.due ? day(entry.due) : null,
        late:
          r.status === 'posted' &&
          open !== null &&
          open > 0 &&
          !!entry?.due &&
          day(entry.due) < workshopDay(),
        id: r.id,
        number: r.number,
        supplier: r.supplier.name,
        status: r.status,
        version: r.version,
        documentDate: r.documentDate.toISOString().slice(0, 10),
        receivedDate: r.receivedDate.toISOString().slice(0, 10),
        total,
      }
    })
    return filter
      ? result
          .filter((r) => (filter === 'late' ? r.late : r.state === filter))
          .slice((page - 1) * 50, page * 50 + 1)
      : result
  })
}
export async function receiptDetail(id: string) {
  return authorized(A.READ, async ({ organizationId }) => {
    const r = await db.supplierReceipt.findFirstOrThrow({
      where: { id, organizationId },
      include: { supplier: { select: { name: true } }, lines: { orderBy: { position: 'asc' } } },
    })
    const people = await db.user.findMany({
      where: {
        id: { in: [r.createdById, r.postedById, r.cancelledById].filter((x): x is string => !!x) },
      },
      select: { id: true, name: true },
    })
    const actor = (id: string | null) => people.find((p) => p.id === id)?.name ?? id
    return {
      ...r,
      creator: actor(r.createdById),
      poster: actor(r.postedById),
      canceller: actor(r.cancelledById),
      documentDate: r.documentDate.toISOString().slice(0, 10),
      receivedDate: r.receivedDate.toISOString().slice(0, 10),
      lines: r.lines.map((l) => ({
        ...l,
        quantity: l.quantity.toString(),
        unitPrice: l.unitPrice.toString(),
        amount: l.amount.toFixed(2),
      })),
    }
  })
}
export async function saveDraft(input: unknown, post = false) {
  return authorized(post ? [A.CREATE, A.UPDATE] : A.CREATE, async ({ organizationId, userId }) => {
    const d = draftSchema.parse(input)
    const result = await db.$transaction(async (tx) => {
      const supplier = await tx.counterparty.findFirst({
        where: {
          id: d.supplierId,
          organizationId,
          isArchived: false,
          supplierProfile: { isNot: null },
        },
      })
      if (!supplier) throw new Error('Оберіть активного постачальника.')
      const fields = {
        supplierId: d.supplierId,
        number: d.number,
        documentDate: d.documentDate,
        receivedDate: d.receivedDate,
      }
      const existing = await tx.supplierReceipt.findFirst({
        where: {
          organizationId,
          supplierId: d.supplierId,
          number: d.number,
          documentDate: d.documentDate,
        },
      })
      if (existing && (existing.id !== d.id || d.version === 0))
        return { id: existing.id, duplicate: existing.id !== d.id }
      if (d.version === 0)
        await tx.supplierReceipt.create({
          data: { id: d.id, organizationId, createdById: userId, ...fields },
        })
      else {
        const changed = await tx.supplierReceipt.updateMany({
          where: { id: d.id, organizationId, version: d.version, status: 'draft' },
          data: { ...fields, version: { increment: 1 } },
        })
        if (!changed.count) throw new Error('Документ змінився. Оновіть сторінку.')
        await tx.supplierReceiptLine.deleteMany({ where: { receiptId: d.id } })
      }
      const parts = await tx.inventoryPart.findMany({
        where: {
          organizationId,
          isArchived: false,
        },
        select: {
          id: true,
          unit: true,
          partNumber: true,
          supplierArticles: {
            where: { supplierId: d.supplierId },
            select: { supplierId: true, normalized: true },
          },
        },
      })
      const lines = []
      for (const [position, line] of d.lines.entries()) {
        let partId: string | null = null
        const article = line.kind === 'part' ? line.article?.trim() : null
        if (line.kind === 'part') {
          if (!article || !articleKey(article)) throw new Error('Вкажіть артикул кожного товару.')
          const matches = matchArticle(parts, d.supplierId, article)
          const selected =
            matches.length === 1 ? matches[0] : parts.find((p) => p.id === line.partId)
          if (
            selected &&
            ((line.partId && selected.id !== line.partId) ||
              (matches.length > 1 && !matches.includes(selected)) ||
              (selected.unit || 'шт') !== line.unit)
          )
            throw new Error('Зіставлення товару змінилося. Перевірте рядок.')
          if (selected) {
            const normalized = articleKey(article)
            const mapping = await tx.supplierArticle.upsert({
              where: {
                organizationId_supplierId_normalized: {
                  organizationId,
                  supplierId: d.supplierId,
                  normalized,
                },
              },
              create: {
                organizationId,
                supplierId: d.supplierId,
                normalized,
                article,
                partId: selected.id,
              },
              update: {},
              select: { partId: true },
            })
            if (mapping.partId !== selected.id)
              throw new Error('Артикул уже пов’язаний з іншою карткою.')
            partId = selected.id
          }
        }
        lines.push({
          ...line,
          article,
          partId,
          receiptId: d.id,
          position,
          amount: storedLineAmount(line),
        })
      }
      await tx.supplierReceiptLine.createMany({ data: lines })
      if (post)
        await transitionReceipt(tx, organizationId, userId, d.id, d.version + 1, 'posted', '')
      return { id: d.id, duplicate: false }
    })
    if (post && !result.duplicate) await onInventoryChanged(organizationId)
    revalidatePath('/receipts')
    return result
  })
}
export async function changeReceipt(
  id: string,
  version: number,
  target: 'posted' | 'cancelled',
  reason: string
) {
  if (
    typeof id !== 'string' ||
    !id ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    typeof reason !== 'string'
  )
    throw new Error('Некоректний документ або версія.')
  if (target !== 'posted' && target !== 'cancelled') throw new Error('Невідома дія')
  return authorized(
    target === 'posted' ? A.UPDATE : A.DELETE,
    async ({ organizationId, userId }) => {
      await db.$transaction((tx) =>
        transitionReceipt(tx, organizationId, userId, id, version, target, reason.slice(0, 1000))
      )
      await onInventoryChanged(organizationId)
      revalidatePath('/receipts')
      revalidatePath('/receipts/' + id)
      return true
    }
  )
}
