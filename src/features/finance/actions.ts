'use server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { PermissionAction as A, PermissionSubject as S } from '@/lib/permissions'
import {
  accessibleAccounts,
  financeCapabilities,
  assertAccountAccess,
  assertFinancePermission,
  assertOperationDate,
} from './access'
import { cents, decimal, normalizeMoney, transactionInput } from './money'
import { dateKey, fingerprint, lockFinance, postMoney } from './ledger'
import { workshopTimeZone } from '@/lib/workshop-timezone'
import { toSafeWorkshopDate } from '@/lib/workshop-datetime'
import { zonedDayKey } from '@/lib/timezone'
import { paymentRolesMissingCashAccess } from './readiness'

export async function financeChoices() {
  return withAuth(async (ctx) => {
    const settings = await db.financeSettings.findUnique({
      where: { organizationId: ctx.organizationId },
    })
    if (!settings?.activatedOn) return { active: false, accounts: [] }
    const accounts = await accessibleAccounts(ctx, true)
    return {
      active: true,
      accounts: accounts
        .filter((a) => !a.isArchived)
        .map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
    }
  })
}
export async function financeReport(asOf: string) {
  return withAuth(
    async (ctx) => {
      z.string().date().parse(asOf)
      const capabilities = await financeCapabilities(ctx)
      const accounts = await accessibleAccounts(ctx)
      const postAccounts = await accessibleAccounts(ctx, true)
      const roles = capabilities.manage
        ? await db.role.findMany({
            where: { organizationId: ctx.organizationId },
            select: { id: true, name: true },
          })
        : []
      const ids = accounts.map((a) => a.id)
      const scope = { organizationId: ctx.organizationId }
      const drafts = await db.financialDocument.findMany({
        where: {
          ...scope,
          status: 'draft',
          AND: [
            { OR: [{ sourceAccountId: null }, { sourceAccountId: { in: ids } }] },
            { OR: [{ targetAccountId: null }, { targetAccountId: { in: ids } }] },
          ],
        },
        orderBy: { createdAt: 'desc' },
      })
      const [settings, entries, categories, entities, pending, batches] = await Promise.all([
        db.financeSettings.findUnique({ where: scope }),
        db.moneyEntry.findMany({
          where: { ...scope, accountId: { in: ids }, date: { lte: new Date(asOf + 'T00:00:00Z') } },
          include: {
            document: {
              include: {
                category: true,
                reversal: { select: { id: true } },
                refunds: { select: { amount: true } },
                payment: { select: { serviceRecord: { select: { id: true, vehicleId: true } } } },
                supplierEntry: { select: { supplierId: true } },
              },
            },
          },
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        }),
        db.cashFlowCategory.findMany({ where: scope, orderBy: { name: 'asc' } }),
        db.ownLegalEntity.findMany({ where: scope }),
        capabilities.manage
          ? db.financialDocument.findMany({
              where: { ...scope, status: 'pending' },
              orderBy: { createdAt: 'desc' },
            })
          : Promise.resolve([]),
        capabilities.manage
          ? db.financeCutoverBatch.findMany({
              where: scope,
              orderBy: { createdAt: 'desc' },
              take: 10,
            })
          : Promise.resolve([]),
      ])
      const unlinked =
        capabilities.manage && settings?.activatedAt
          ? await db.payment.findMany({
              where: {
                serviceRecord: { organizationId: ctx.organizationId },
                createdAt: {
                  gte: toSafeWorkshopDate(
                    dateKey(settings.activatedOn!),
                    await workshopTimeZone(ctx.organizationId)
                  )!,
                },
                financialDocument: null,
                amount: { not: 0 },
              },
              select: {
                id: true,
                date: true,
                amount: true,
                amountExact: true,
                provider: true,
                note: true,
              },
              orderBy: { createdAt: 'desc' },
            })
          : []
      const running = new Map<string, string>(),
        balances = new Map<string, bigint>()
      for (const e of [...entries].reverse()) {
        const value = (balances.get(e.accountId) ?? BigInt('0')) + cents(e.amount.toFixed(2))
        balances.set(e.accountId, value)
        running.set(e.id, decimal(value))
      }
      const authors = await db.user.findMany({
        where: { id: { in: [...new Set(entries.map((e) => e.document.createdById))] } },
        select: { id: true, name: true },
      })
      return {
        asOf,
        drafts: drafts.map((d) => ({
          id: d.id,
          kind: d.kind,
          date: dateKey(d.date),
          amount: d.amount.toFixed(2),
          note: d.note,
        })),
        unlinked: unlinked.map((p) => ({
          id: p.id,
          date: dateKey(p.date),
          amount: p.amountExact?.toFixed(2) ?? p.amount.toFixed(2),
          provider: p.provider,
          note: p.note,
        })),
        active: !!settings?.activatedOn,
        start: settings?.activatedOn ? dateKey(settings.activatedOn) : null,
        isAdmin: capabilities.manage,
        capabilities,
        roles,
        postAccountIds: postAccounts.filter((a) => !a.isArchived).map((a) => a.id),
        accounts: accounts.map((a) => ({
          id: a.id,
          name: a.name,
          kind: a.kind,
          entity: a.legalEntity.name,
          archived: a.isArchived,
          balance: decimal(
            entries
              .filter((e) => e.accountId === a.id)
              .reduce((s, e) => s + cents(e.amount.toFixed(2)), BigInt('0'))
          ),
        })),
        entries: entries.map((e) => ({
          id: e.id,
          documentId: e.documentId,
          accountId: e.accountId,
          date: dateKey(e.date),
          amount: e.amount.toFixed(2),
          kind: e.document.kind,
          note: e.document.note,
          category: e.document.category?.name ?? '',
          counterparty: e.document.counterpartyLabel ?? '',
          author:
            authors.find((a) => a.id === e.document.createdById)?.name ?? e.document.createdById,
          reversalOfId: e.document.reversalOfId,
          reversed: !!e.document.reversal,
          refunded: e.document.refunds.length > 0,
          runningBalance: running.get(e.id)!,
          link: e.document.payment
            ? e.document.payment.serviceRecord.vehicleId
              ? `/vehicles/${e.document.payment.serviceRecord.vehicleId}/service/${e.document.payment.serviceRecord.id}`
              : `/sales/${e.document.payment.serviceRecord.id}`
            : e.document.supplierEntry
              ? `/settlements?supplier=${e.document.supplierEntry.supplierId}`
              : null,
        })),
        categories: categories.map((c) => ({
          id: c.id,
          name: c.name,
          direction: c.direction,
          archived: c.isArchived,
        })),
        entities: entities.map((e) => ({ id: e.id, name: e.name })),
        pending: pending.map((d) => ({
          id: d.id,
          date: dateKey(d.date),
          amount: d.amount.toFixed(2),
          note: d.note,
        })),
        batches: batches.map((b) => ({
          id: b.id,
          date: dateKey(b.date),
          status: b.status,
          balances: b.balances,
        })),
      }
    },
    { requiredPermissions: [{ action: A.READ, subject: S.FINANCE }] }
  )
}
export async function saveFinanceDirectory(raw: unknown) {
  return withAuth(
    async (ctx) => {
      const input = z
        .discriminatedUnion('type', [
          z.object({
            type: z.literal('rename'),
            kind: z.enum(['account', 'entity', 'category']),
            id: z.string(),
            name: z.string().trim().min(1).max(150),
          }),
          z.object({
            type: z.literal('entity'),
            name: z.string().trim().min(1).max(150),
            taxId: z.string().max(30).optional(),
          }),
          z.object({
            type: z.literal('account'),
            name: z.string().trim().min(1).max(150),
            kind: z.enum(['cash', 'bank']),
            legalEntityId: z.string().min(1),
            iban: z.string().max(34).optional(),
            allowNegative: z.boolean().default(false),
          }),
          z.object({
            type: z.literal('category'),
            name: z.string().trim().min(1).max(150),
            direction: z.enum(['income', 'expense']),
          }),
          z.object({ type: z.literal('archive'), accountId: z.string(), archived: z.boolean() }),
          z.object({
            type: z.literal('access'),
            accountId: z.string(),
            roleId: z.string(),
            canRead: z.boolean(),
            canPost: z.boolean(),
          }),
        ])
        .parse(raw)
      const org = ctx.organizationId
      await db.$transaction(async (tx) => {
        await lockFinance(tx, org)
        if (input.type === 'rename') {
          const args = { where: { id: input.id, organizationId: org }, data: { name: input.name } }
          const result =
            input.kind === 'account'
              ? await tx.moneyAccount.updateMany(args)
              : input.kind === 'entity'
                ? await tx.ownLegalEntity.updateMany(args)
                : await tx.cashFlowCategory.updateMany(args)
          if (result.count !== 1) throw new Error('Запис недоступний.')
        }
        if (input.type === 'entity')
          await tx.ownLegalEntity.create({
            data: { organizationId: org, name: input.name, taxId: input.taxId },
          })
        if (input.type === 'category')
          await tx.cashFlowCategory.create({
            data: { organizationId: org, name: input.name, direction: input.direction },
          })
        if (input.type === 'account') {
          const own = await tx.ownLegalEntity.findFirst({
            where: { id: input.legalEntityId, organizationId: org, isArchived: false },
          })
          if (!own) throw new Error('Власні реквізити недоступні.')
          if (input.kind === 'cash' && input.allowNegative)
            throw new Error('Готівкова каса не може мати від’ємний залишок.')
          await tx.moneyAccount.create({
            data: {
              organizationId: org,
              name: input.name,
              kind: input.kind,
              legalEntityId: own.id,
              iban: input.iban,
              allowNegative: input.allowNegative,
            },
          })
        }
        if (input.type === 'archive')
          await tx.moneyAccount.updateMany({
            where: { id: input.accountId, organizationId: org },
            data: { isArchived: input.archived },
          })
        if (input.type === 'access') {
          const account = await tx.moneyAccount.findFirst({
            where: { id: input.accountId, organizationId: org },
          })
          const role = await tx.role.findFirst({ where: { id: input.roleId, organizationId: org } })
          if (!account || !role) throw new Error('Каса або роль недоступні.')
          await tx.moneyAccountAccess.upsert({
            where: { accountId_roleId: { accountId: account.id, roleId: role.id } },
            create: {
              organizationId: org,
              accountId: account.id,
              roleId: role.id,
              canRead: input.canRead || input.canPost,
              canPost: input.canPost,
            },
            update: { canRead: input.canRead || input.canPost, canPost: input.canPost },
          })
        }
      })
      revalidatePath('/finance')
      return true
    },
    {
      requiredPermissions: [{ action: A.MANAGE, subject: S.FINANCE }],
      audit: {
        action: 'finance.saveFinanceDirectory',
        entity: 'Finance',
        message: 'saveFinanceDirectory',
      },
    }
  )
}
export async function postFinanceDocument(raw: unknown) {
  return withAuth(
    async (ctx) => {
      const input = transactionInput.parse(raw)
      await assertOperationDate(ctx, input.date)
      if (input.kind === 'transfer')
        await assertFinancePermission(ctx, A.CREATE, S.FINANCE_TRANSFER)
      if (input.kind === 'income' && (!input.targetAccountId || input.sourceAccountId))
        throw new Error('Оберіть рахунок надходження.')
      if (input.kind === 'expense' && (!input.sourceAccountId || input.targetAccountId))
        throw new Error('Оберіть рахунок списання.')
      if (input.kind === 'transfer' && (!input.sourceAccountId || !input.targetAccountId))
        throw new Error('Оберіть два рахунки.')
      const doc = await db.$transaction(async (tx) => {
        await lockFinance(tx, ctx.organizationId)
        await assertAccountAccess(ctx, [input.sourceAccountId, input.targetAccountId], tx)
        return postMoney(tx, ctx.organizationId, ctx.userId, input)
      })
      revalidatePath('/finance')
      return { id: doc.id }
    },
    {
      requiredPermissions: [{ action: A.UPDATE, subject: S.FINANCE }],
      audit: {
        action: 'finance.postFinanceDocument',
        entity: 'Finance',
        message: 'postFinanceDocument',
      },
    }
  )
}
export async function prepareCashOpening(raw: unknown) {
  return withAuth(
    async (ctx) => {
      const input = z
        .object({
          date: z.string().date(),
          balances: z
            .array(
              z.object({ accountId: z.string(), amount: z.string().transform(normalizeMoney) })
            )
            .min(1),
        })
        .parse(raw)
      if (
        input.balances.some((b) => cents(b.amount) < BigInt('0')) ||
        new Set(input.balances.map((b) => b.accountId)).size !== input.balances.length
      )
        throw new Error('Перевірте початкові залишки.')
      const batch = await db.$transaction(async (tx) => {
        await lockFinance(tx, ctx.organizationId)
        const settings = await tx.financeSettings.findUnique({
          where: { organizationId: ctx.organizationId },
        })
        if (settings?.activatedOn) throw new Error('Облік уже активовано.')
        const accounts = await tx.moneyAccount.findMany({
          where: { organizationId: ctx.organizationId, isArchived: false },
        })
        if (
          accounts.length !== input.balances.length ||
          accounts.some((a) => !input.balances.some((b) => b.accountId === a.id))
        )
          throw new Error('Вкажіть залишок кожного активного рахунку.')
        return tx.financeCutoverBatch.create({
          data: {
            organizationId: ctx.organizationId,
            date: new Date(input.date + 'T00:00:00Z'),
            balances: input.balances,
            fingerprint: fingerprint(input),
            createdById: ctx.userId,
          },
        })
      })
      revalidatePath('/finance')
      return { id: batch.id }
    },
    {
      requiredPermissions: [{ action: A.MANAGE, subject: S.FINANCE }],
      audit: {
        action: 'finance.prepareCashOpening',
        entity: 'Finance',
        message: 'prepareCashOpening',
      },
    }
  )
}
export async function activateCashOpening(batchId: string) {
  return withAuth(
    async (ctx) => {
      const { workshopCurrencySettings } = await import('@/lib/workshop-currency')
      if ((await workshopCurrencySettings(ctx.organizationId)).currencyCode !== 'UAH')
        throw new Error('Перед активацією оберіть гривню в налаштуваннях організації.')
      // Deployment does not grant approval to activate real balances.
      if (process.env.FINANCE_ACTIVATION_ALLOWED !== '1')
        throw new Error('Активацію вимкнено. Потрібне окреме погодження початкових залишків.')
      await db.$transaction(async (tx) => {
        await lockFinance(tx, ctx.organizationId)
        const batch = await tx.financeCutoverBatch.findFirstOrThrow({
          where: { id: batchId, organizationId: ctx.organizationId },
        })
        if (batch.status === 'activated') return
        await assertOperationDate(ctx, dateKey(batch.date))
        const current = await tx.financeSettings.findUnique({
          where: { organizationId: ctx.organizationId },
        })
        if (current?.activatedOn) throw new Error('Облік уже активовано іншим пакетом.')
        const zone = await workshopTimeZone(ctx.organizationId)
        if (dateKey(batch.date) !== zonedDayKey(new Date(), zone))
          throw new Error(
            'Активація можлива на початок поточного дня до першої оплати. Оновіть звірку.'
          )
        const boundary = toSafeWorkshopDate(dateKey(batch.date), zone)!
        const [payments, supplierPayments] = await Promise.all([
          tx.payment.count({
            where: {
              serviceRecord: { organizationId: ctx.organizationId },
              OR: [{ date: { gte: boundary } }, { createdAt: { gte: boundary } }],
            },
          }),
          tx.supplierEntry.count({
            where: {
              organizationId: ctx.organizationId,
              kind: { in: ['payment', 'refund'] },
              OR: [{ date: { gte: batch.date } }, { createdAt: { gte: boundary } }],
            },
          }),
        ])
        if (payments || supplierPayments)
          throw new Error(
            'За день активації вже є оплати. Проведіть звірку і активуйте облік перед першою оплатою наступного дня.'
          )
        const balances = z
          .array(z.object({ accountId: z.string(), amount: z.string() }))
          .parse(batch.balances)
        const accounts = await tx.moneyAccount.findMany({
          where: { organizationId: ctx.organizationId, isArchived: false },
        })
        if (
          accounts.length !== balances.length ||
          accounts.some((a) => !balances.some((b) => b.accountId === a.id))
        )
          throw new Error('Склад рахунків змінився. Підготуйте нову звірку.')
        const members = await tx.organizationMember.findMany({
          where: { organizationId: ctx.organizationId },
          include: {
            customRole: { include: { permissions: true } },
            user: { select: { name: true, isSuperAdmin: true } },
          },
        })
        const accessRows = await tx.moneyAccountAccess.findMany({
          where: {
            organizationId: ctx.organizationId,
            canPost: true,
            account: { isArchived: false },
          },
        })
        const blocked = paymentRolesMissingCashAccess(
          members.map((m) => ({
            name: m.user.name ?? m.userId,
            administrator:
              ['owner', 'admin'].includes(m.role) || !!m.customRole?.isAdmin || m.user.isSuperAdmin,
            roleId: m.roleId,
            permissions: (m.customRole?.permissions ?? []).map((p) => ({
              action: p.action as A,
              subject: p.subject as S,
            })),
          })),
          new Set(accessRows.map((a) => a.roleId))
        )
        if (blocked.length)
          throw new Error(
            `Перед активацією надайте право проведення та доступ до кас працівникам: ${blocked.join(', ')}`
          )
        for (const b of balances)
          await postMoney(
            tx,
            ctx.organizationId,
            ctx.userId,
            {
              requestId: `opening:${batch.id}:${b.accountId}`,
              kind: 'opening',
              date: dateKey(batch.date),
              amount: b.amount,
              targetAccountId: b.accountId,
              note: 'Погоджений початковий залишок',
            },
            { opening: true }
          )
        await tx.financeSettings.upsert({
          where: { organizationId: ctx.organizationId },
          create: {
            organizationId: ctx.organizationId,
            activatedOn: batch.date,
            activatedAt: new Date(),
            activatedById: ctx.userId,
            version: 1,
          },
          update: {
            activatedOn: batch.date,
            activatedAt: new Date(),
            activatedById: ctx.userId,
            version: { increment: 1 },
          },
        })
        await tx.financeCutoverBatch.update({
          where: { id: batch.id },
          data: { status: 'activated', approvedAt: new Date(), approvedById: ctx.userId },
        })
      })
      revalidatePath('/finance')
      return true
    },
    {
      requiredPermissions: [{ action: A.MANAGE, subject: S.FINANCE }],
      audit: {
        action: 'finance.activateCashOpening',
        entity: 'Finance',
        message: 'activateCashOpening',
      },
    }
  )
}

export async function reverseMoneyDocument(raw: unknown) {
  return withAuth(
    async (ctx) => {
      const input = z
        .object({
          id: z.string(),
          requestId: z.string().uuid(),
          date: z.string().date(),
          reason: z.string().trim().min(1).max(1000),
        })
        .parse(raw)
      await assertOperationDate(ctx, input.date)
      await db.$transaction(async (tx) => {
        await lockFinance(tx, ctx.organizationId)
        const old = await tx.financialDocument.findFirstOrThrow({
          where: { id: input.id, organizationId: ctx.organizationId, status: 'posted' },
          include: { reversal: true, payment: true, supplierEntry: true, refunds: true },
        })
        if (old.reversal) {
          if (
            old.reversal.requestId === input.requestId &&
            old.reversal.note === input.reason &&
            dateKey(old.reversal.date) === input.date
          )
            return
          throw new Error('Операцію вже сторновано.')
        }
        if (['opening', 'reversal', 'refund'].includes(old.kind) || old.refunds.length)
          throw new Error('Цю операцію не можна сторнувати. Потрібна звірка.')
        if (input.date < dateKey(old.date)) throw new Error('Сторно не може передувати операції.')
        await assertAccountAccess(
          ctx,
          [old.sourceAccountId ?? undefined, old.targetAccountId ?? undefined],
          tx
        )
        let reversalPaymentId: string | undefined
        if (old.payment) {
          const record = await tx.serviceRecord.findUniqueOrThrow({
            where: { id: old.payment.serviceRecordId },
            include: { payments: true },
          })
          const { getDocumentLockSettings } = await import('@/lib/document-lock.server')
          const { invoiceLockState, DocumentLockedError } = await import('@/lib/document-lock')
          const settings = await getDocumentLockSettings(ctx.organizationId)
          const before = invoiceLockState(record, settings)
          const after = invoiceLockState(
            { ...record, payments: [...record.payments, { amount: -Number(old.amount) }] },
            settings
          )
          if (before.locked && !after.locked && before.reason)
            throw new DocumentLockedError(before.reason)
          // An append-only negative payment preserves existing totals and print consumers.
          const compensation = await tx.payment.create({
            data: {
              serviceRecordId: record.id,
              amount: -Number(old.amount),
              amountExact: old.amount.negated(),
              date: new Date(input.date + 'T12:00:00Z'),
              method: old.payment.method,
              note: `Сторно: ${input.reason}`,
              provider: 'finance-reversal',
              externalId: old.id,
            },
          })
          reversalPaymentId = compensation.id
        }
        if (old.supplierEntry) {
          const { lockSupplier, reverseEntry } = await import('@/features/settlements/ledger')
          const { workshopDay } = await import('@/features/settlements/amounts')
          if (input.date !== workshopDay())
            throw new Error('Сторно оплати постачальнику виконується поточною датою.')
          await lockSupplier(tx, ctx.organizationId, old.supplierEntry.supplierId)
          await reverseEntry(
            tx,
            ctx.organizationId,
            old.supplierEntry.supplierId,
            old.supplierEntry.id,
            ctx.userId,
            input.reason
          )
        }
        await postMoney(tx, ctx.organizationId, ctx.userId, {
          requestId: input.requestId,
          kind: 'reversal',
          date: input.date,
          amount: old.amount.toFixed(2),
          sourceAccountId: old.targetAccountId ?? undefined,
          targetAccountId: old.sourceAccountId ?? undefined,
          reversalOfId: old.id,
          paymentId: reversalPaymentId,
          note: input.reason,
        })
      })
      revalidatePath('/finance')
      revalidatePath('/settlements')
      revalidatePath('/work-orders')
      return true
    },
    {
      requiredPermissions: [{ action: A.DELETE, subject: S.FINANCE }],
      audit: {
        action: 'finance.reverseMoneyDocument',
        entity: 'Finance',
        message: 'reverseMoneyDocument',
      },
    }
  )
}

export async function assignUnlinkedPayment(raw: unknown) {
  return withAuth(
    async (ctx) => {
      const input = z
        .object({ paymentId: z.string(), accountId: z.string(), requestId: z.string().uuid() })
        .parse(raw)
      await db.$transaction(async (tx) => {
        await lockFinance(tx, ctx.organizationId)
        await assertAccountAccess(ctx, [input.accountId], tx)
        const p = await tx.payment.findFirstOrThrow({
          where: { id: input.paymentId, serviceRecord: { organizationId: ctx.organizationId } },
        })
        const { workshopTimeZone } = await import('@/lib/workshop-timezone')
        const { zonedDayKey } = await import('@/lib/timezone')
        const date = zonedDayKey(p.date, await workshopTimeZone(ctx.organizationId))
        await assertOperationDate(ctx, date)
        const amount = p.amountExact?.toFixed(2) ?? normalizeMoney(p.amount.toFixed(2))
        if (!p.amountExact)
          await tx.payment.update({ where: { id: p.id }, data: { amountExact: amount } })
        await postMoney(tx, ctx.organizationId, ctx.userId, {
          requestId: input.requestId,
          kind: cents(amount) < BigInt('0') ? 'refund' : 'customer_payment',
          date,
          amount: decimal(cents(amount) < BigInt('0') ? -cents(amount) : cents(amount)),
          ...(cents(amount) < BigInt('0')
            ? { sourceAccountId: input.accountId }
            : { targetAccountId: input.accountId }),
          paymentId: p.id,
          note: 'Звірка зовнішньої оплати',
        })
      })
      revalidatePath('/finance')
      return true
    },
    {
      requiredPermissions: [{ action: A.MANAGE, subject: S.FINANCE }],
      audit: {
        action: 'finance.assignUnlinkedPayment',
        entity: 'Finance',
        message: 'assignUnlinkedPayment',
      },
    }
  )
}

export async function refundMoneyDocument(raw: unknown) {
  return withAuth(
    async (ctx) => {
      const input = z
        .object({
          id: z.string(),
          requestId: z.string().uuid(),
          date: z.string().date(),
          amount: z.string().transform(normalizeMoney),
          reason: z.string().trim().min(1).max(1000),
        })
        .parse(raw)
      await assertOperationDate(ctx, input.date)
      await db.$transaction(async (tx) => {
        await lockFinance(tx, ctx.organizationId)
        const existing = await tx.financialDocument.findUnique({
          where: {
            organizationId_requestId: {
              organizationId: ctx.organizationId,
              requestId: input.requestId,
            },
          },
        })
        if (existing) {
          if (
            existing.originalId !== input.id ||
            existing.amount.toFixed(2) !== input.amount ||
            existing.note !== input.reason ||
            dateKey(existing.date) !== input.date
          )
            throw new Error('Запит уже виконано з іншими даними.')
          return
        }
        const old = await tx.financialDocument.findFirstOrThrow({
          where: { id: input.id, organizationId: ctx.organizationId, status: 'posted' },
          include: { reversal: true, refunds: true, payment: true, supplierEntry: true },
        })
        if (old.reversal || !['customer_payment', 'supplier_payment'].includes(old.kind))
          throw new Error('Повернення доступне для чинної оплати.')
        if (input.date < dateKey(old.date)) throw new Error('Повернення не може передувати оплаті.')
        const amount = cents(input.amount),
          returned = old.refunds.reduce((s, d) => s + cents(d.amount.toFixed(2)), BigInt('0'))
        if (amount <= BigInt('0') || amount > cents(old.amount.toFixed(2)) - returned)
          throw new Error('Сума перевищує доступне повернення.')
        await assertAccountAccess(
          ctx,
          [old.sourceAccountId ?? undefined, old.targetAccountId ?? undefined],
          tx
        )
        let paymentId: string | undefined, supplierEntryId: string | undefined
        if (old.payment) {
          const record = await tx.serviceRecord.findUniqueOrThrow({
            where: { id: old.payment.serviceRecordId },
            include: { payments: true },
          })
          const { getDocumentLockSettings } = await import('@/lib/document-lock.server')
          const { invoiceLockState, DocumentLockedError } = await import('@/lib/document-lock')
          const settings = await getDocumentLockSettings(ctx.organizationId)
          const before = invoiceLockState(record, settings),
            after = invoiceLockState(
              { ...record, payments: [...record.payments, { amount: -Number(input.amount) }] },
              settings
            )
          if (before.locked && !after.locked && before.reason)
            throw new DocumentLockedError(before.reason)
          const p = await tx.payment.create({
            data: {
              serviceRecordId: record.id,
              amount: -Number(input.amount),
              amountExact: decimal(-amount),
              date: new Date(input.date + 'T12:00:00Z'),
              method: old.payment.method,
              note: `Повернення: ${input.reason}`,
              provider: 'finance-refund',
              externalId: input.requestId,
            },
          })
          paymentId = p.id
        }
        if (old.supplierEntry) {
          const { lockSupplier, allocate } = await import('@/features/settlements/ledger')
          await lockSupplier(tx, ctx.organizationId, old.supplierEntry.supplierId)
          const e = await tx.supplierEntry.create({
            data: {
              organizationId: ctx.organizationId,
              supplierId: old.supplierEntry.supplierId,
              kind: 'refund',
              amount: input.amount,
              date: new Date(input.date + 'T00:00:00Z'),
              note: input.reason,
              createdById: ctx.userId,
            },
          })
          supplierEntryId = e.id
          await allocate(
            tx,
            ctx.organizationId,
            old.supplierEntry.supplierId,
            ctx.userId,
            input.requestId,
            old.supplierEntry.id,
            e.id,
            input.amount,
            new Date(input.date + 'T00:00:00Z')
          )
        }
        await postMoney(tx, ctx.organizationId, ctx.userId, {
          requestId: input.requestId,
          kind: 'refund',
          date: input.date,
          amount: input.amount,
          sourceAccountId: old.targetAccountId ?? undefined,
          targetAccountId: old.sourceAccountId ?? undefined,
          originalId: old.id,
          paymentId,
          supplierEntryId,
          note: input.reason,
        })
      })
      revalidatePath('/finance')
      revalidatePath('/settlements')
      return true
    },
    {
      requiredPermissions: [{ action: A.DELETE, subject: S.FINANCE }],
      audit: {
        action: 'finance.refundMoneyDocument',
        entity: 'Finance',
        message: 'refundMoneyDocument',
      },
    }
  )
}

export async function saveFinanceDraft(raw: unknown) {
  return withAuth(
    async (ctx) => {
      const input = transactionInput.parse(raw)
      await db.$transaction(async (tx) => {
        await lockFinance(tx, ctx.organizationId)
        await assertAccountAccess(ctx, [input.sourceAccountId, input.targetAccountId], tx)
        if (
          input.categoryId &&
          !(await tx.cashFlowCategory.findFirst({
            where: { id: input.categoryId, organizationId: ctx.organizationId, isArchived: false },
          }))
        )
          throw new Error('Стаття недоступна.')
        const hash = fingerprint(input)
        const existing = await tx.financialDocument.findUnique({
          where: {
            organizationId_requestId: {
              organizationId: ctx.organizationId,
              requestId: input.requestId,
            },
          },
        })
        if (existing) {
          if (existing.fingerprint !== hash) throw new Error('Запит уже виконано з іншими даними.')
          return
        }
        await tx.financialDocument.create({
          data: {
            ...input,
            date: new Date(input.date + 'T00:00:00Z'),
            organizationId: ctx.organizationId,
            fingerprint: hash,
            createdById: ctx.userId,
            status: 'draft',
          },
        })
      })
      revalidatePath('/finance')
      return true
    },
    { requiredPermissions: [{ action: A.CREATE, subject: S.FINANCE }] }
  )
}
export async function postSavedFinanceDraft(id: string) {
  return withAuth(
    async (ctx) => {
      await db.$transaction(async (tx) => {
        await lockFinance(tx, ctx.organizationId)
        const d = await tx.financialDocument.findFirstOrThrow({
          where: { id, organizationId: ctx.organizationId },
        })
        if (d.status === 'posted') return
        if (d.status !== 'draft') throw new Error('Документ не є чернеткою.')
        await assertOperationDate(ctx, dateKey(d.date))
        if (d.kind === 'transfer') await assertFinancePermission(ctx, A.CREATE, S.FINANCE_TRANSFER)
        await assertAccountAccess(
          ctx,
          [d.sourceAccountId ?? undefined, d.targetAccountId ?? undefined],
          tx
        )
        await postMoney(tx, ctx.organizationId, ctx.userId, {
          requestId: d.requestId,
          kind: d.kind,
          date: dateKey(d.date),
          amount: d.amount.toFixed(2),
          sourceAccountId: d.sourceAccountId ?? undefined,
          targetAccountId: d.targetAccountId ?? undefined,
          categoryId: d.categoryId ?? undefined,
          counterpartyLabel: d.counterpartyLabel ?? undefined,
          note: d.note,
        })
      })
      revalidatePath('/finance')
      return true
    },
    { requiredPermissions: [{ action: A.UPDATE, subject: S.FINANCE }] }
  )
}
export async function discardFinanceDraft(id: string) {
  return withAuth(
    async (ctx) => {
      await db.$transaction(async (tx) => {
        await lockFinance(tx, ctx.organizationId)
        const d = await tx.financialDocument.findFirstOrThrow({
          where: { id, organizationId: ctx.organizationId, status: 'draft' },
        })
        await assertAccountAccess(
          ctx,
          [d.sourceAccountId ?? undefined, d.targetAccountId ?? undefined],
          tx
        )
        await tx.financialDocument.delete({ where: { id: d.id } })
      })
      revalidatePath('/finance')
      return true
    },
    { requiredPermissions: [{ action: A.CREATE, subject: S.FINANCE }] }
  )
}
