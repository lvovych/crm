import { readFinancialSnapshot } from './financialSnapshot'
import { z } from 'zod'
import { commandSchema, dateText } from './contracts'
import { D, moneyText } from './amounts'
import {
  assertPeriod,
  ledgerCommand,
  metadata,
  type LedgerContext,
  type LedgerDB,
  type Tx,
} from './transaction'
import { nextDocumentNumber } from './numbers'
import { allocated, createStockLedger, postMoneyTransactionTx } from './service'

export async function customerBalance(tx: Tx, ctx: LedgerContext, recordId: string) {
  const org = { organizationId: ctx.organizationId }
  const job = await tx.serviceRecord.findFirstOrThrow({
    where: { ...org, id: recordId, financeAccountingMode: 'LEDGER' },
    include: { vehicle: { select: { customerId: true } } },
  })
  const entries = await tx.settlementEntry.findMany({
    where: {
      ...org,
      OR: [{ serviceRecordId: recordId }, { customerAdjustment: { serviceRecordId: recordId } }],
    },
    orderBy: [{ effectiveAt: 'asc' }, { id: 'asc' }],
    include: { customerAdjustment: true },
  })
  let total = D(0),
    debt = D(0),
    credit = D(0)
  const documents = []
  for (const e of entries) {
    const used = await allocated(tx, ctx, e.id, e.polarity),
      remaining = e.amount.minus(used)
    total = total.plus(e.amount.mul(e.polarity === 'DEBIT' ? 1 : -1))
    if (e.polarity === 'DEBIT') debt = debt.plus(remaining)
    else credit = credit.plus(remaining)
    documents.push({
      id: e.id,
      number: e.customerAdjustment?.number ?? job.invoiceNumber ?? job.title,
      kind: e.customerAdjustment?.kind ?? 'INVOICE',
      date: e.effectiveAt.toISOString().slice(0, 10),
      amount: e.amount.toFixed(2),
      remaining: remaining.toFixed(2),
      polarity: e.polarity,
      reason: e.customerAdjustment?.reason ?? null,
    })
  }
  const frozen = readFinancialSnapshot(job.ledgerFinancialSnapshot)
  if (job.billedPartyId && frozen?.entryId === null && frozen.effectiveDate)
    documents.unshift({
      id: job.id,
      number: job.invoiceNumber ?? job.title,
      kind: 'INVOICE',
      date: frozen.effectiveDate,
      amount: '0.00',
      remaining: '0.00',
      polarity: 'DEBIT',
      reason: null,
    })
  const customerId = job.customerId ?? job.vehicle?.customerId
  const party = job.billedPartyId
    ? await tx.settlementParty.findFirst({ where: { ...org, id: job.billedPartyId } })
    : customerId
      ? await tx.settlementParty.findFirst({ where: { ...org, customerId } })
      : null
  const credits = party
    ? await tx.settlementEntry.findMany({
        where: { ...org, partyId: party.id, side: 'AR', polarity: 'CREDIT' },
        orderBy: [{ effectiveAt: 'asc' }, { id: 'asc' }],
      })
    : []
  const advances = []
  for (const entry of credits) {
    const remaining = entry.amount.minus(await allocated(tx, ctx, entry.id, 'CREDIT'))
    if (remaining.gt(0))
      advances.push({
        id: entry.id,
        date: entry.effectiveAt.toISOString().slice(0, 10),
        remaining: remaining.toFixed(2),
      })
  }
  return {
    id: job.id,
    partyId: party?.id ?? null,
    customerId,
    advances,
    advance: advances.reduce((sum, a) => sum.plus(a.remaining), D(0)).toFixed(2),
    issued: Boolean(job.billedPartyId),
    total: total.toFixed(2),
    debt: debt.toFixed(2),
    credit: credit.toFixed(2),
    documents,
  }
}

const adjustmentSchema = commandSchema.extend({
  serviceRecordId: z.string().min(1),
  kind: z.enum(['CREDIT', 'DEBIT']),
  amount: moneyText,
  effectiveAt: dateText,
  reason: z.string().trim().min(5).max(2000),
  confirmed: z.literal(true),
})
export function postCustomerAdjustment(db: LedgerDB, ctx: LedgerContext, raw: unknown) {
  const input = adjustmentSchema.parse(raw)
  return ledgerCommand(db, ctx, 'customer.adjustment', input, async (tx) => {
    await assertPeriod(tx, ctx, input.effectiveAt, false)
    const balance = await customerBalance(tx, ctx, input.serviceRecordId)
    if (!balance.issued || !balance.partyId) throw new Error('Спочатку виставте рахунок')
    if (input.kind === 'CREDIT' && D(input.amount).gt(balance.total))
      throw new Error('Зменшення перевищує вартість рахунку з коригуваннями')
    if (balance.documents.some((d) => d.date > input.effectiveAt.toISOString().slice(0, 10)))
      throw new Error('Коригування не може передувати рахунку або попередньому коригуванню')
    const doc = await tx.customerAdjustment.create({
      data: {
        ...metadata(ctx),
        serviceRecordId: balance.id,
        number: await nextDocumentNumber(
          tx,
          ctx,
          input.kind === 'CREDIT' ? 'CN' : 'DN',
          input.effectiveAt
        ),
        kind: input.kind,
        amount: input.amount,
        effectiveAt: input.effectiveAt,
        reason: input.reason,
      },
    })
    const entry = await tx.settlementEntry.create({
      data: {
        ...metadata(ctx),
        partyId: balance.partyId,
        customerAdjustmentId: doc.id,
        side: 'AR',
        polarity: input.kind,
        amount: input.amount,
        effectiveAt: input.effectiveAt,
        operationKey: 'customer-adjustment:' + doc.id,
      },
    })
    // A credit reduces open invoice debt first. Any remaining credit belongs to the customer;
    // it is never fabricated as a cash payment or an automatic refund.
    if (input.kind === 'CREDIT') {
      let remaining = D(input.amount)
      const nested = {
        $transaction: async (fn: (tx: Tx) => Promise<unknown>) => fn(tx),
      } as unknown as LedgerDB
      for (const debit of balance.documents.filter((d) => d.polarity === 'DEBIT')) {
        const amount = D(debit.remaining).lt(remaining) ? D(debit.remaining) : remaining
        if (amount.lte(0)) continue
        await createStockLedger(nested, ctx).allocateSettlement({
          idempotencyKey: `adjustment:${doc.id}:${debit.id}`,
          debitEntryId: debit.id,
          creditEntryId: entry.id,
          amount: amount.toFixed(2),
          effectiveAt: input.effectiveAt.toISOString().slice(0, 10),
        })
        remaining = remaining.minus(amount)
      }
    }
    return { id: doc.id, number: doc.number, amount: input.amount, entryId: entry.id }
  })
}

const customerPaymentSchema = commandSchema.extend({
  serviceRecordId: z.string().min(1),
  accountId: z.string().min(1),
  amount: moneyText,
  direction: z.enum(['IN', 'OUT']),
  effectiveAt: dateText,
  method: z.string().trim().min(1).max(50),
  note: z.string().max(2000).default(''),
  confirmed: z.literal(true),
})
export function postCustomerMoney(db: LedgerDB, ctx: LedgerContext, raw: unknown) {
  const input = customerPaymentSchema.parse(raw)
  return ledgerCommand(db, ctx, 'customer.money', input, async (tx) => {
    const balance = await customerBalance(tx, ctx, input.serviceRecordId)
    if (!balance.partyId) {
      if (!balance.customerId) throw new Error('Спочатку виберіть клієнта й збережіть наряд')
      const customer = await tx.customer.findFirstOrThrow({
        where: { organizationId: ctx.organizationId, id: balance.customerId },
      })
      const party = await tx.settlementParty.upsert({
        where: {
          organizationId_customerId: {
            organizationId: ctx.organizationId,
            customerId: customer.id,
          },
        },
        create: {
          ...metadata(ctx),
          kind: 'CUSTOMER',
          customerId: customer.id,
          displayNameSnapshot: customer.name,
        },
        update: {},
      })
      balance.partyId = party.id
    }

    const org = { organizationId: ctx.organizationId }
    // A refund requires an existing unallocated customer credit. It must not create a new debt.
    const candidates =
      input.direction === 'IN'
        ? balance.documents
            .filter((d) => d.polarity === 'DEBIT')
            .map((d) => ({ id: d.id, remaining: D(d.remaining) }))
        : await Promise.all(
            (
              await tx.settlementEntry.findMany({
                where: {
                  ...org,
                  partyId: balance.partyId,
                  side: 'AR',
                  polarity: 'CREDIT',
                  effectiveAt: { lte: input.effectiveAt },
                },
                orderBy: [{ effectiveAt: 'asc' }, { id: 'asc' }],
              })
            ).map(async (e) => ({
              id: e.id,
              remaining: e.amount.minus(await allocated(tx, ctx, e.id, 'CREDIT')),
            }))
          )
    if (
      input.direction === 'OUT' &&
      candidates.reduce((s, e) => s.plus(e.remaining), D(0)).lt(input.amount)
    )
      throw new Error('Повернення перевищує доступний аванс або кредит клієнта')
    const payment = await postMoneyTransactionTx(tx, ctx, { ...input, partyId: balance.partyId })
    const nested = {
      $transaction: async (fn: (tx: Tx) => Promise<unknown>) => fn(tx),
    } as unknown as LedgerDB
    let remaining = D(input.amount)
    for (const candidate of candidates) {
      const amount = candidate.remaining.lt(remaining) ? candidate.remaining : remaining
      if (amount.lte(0)) continue
      await createStockLedger(nested, ctx).allocateSettlement({
        idempotencyKey: `customer-money:${payment.id}:${candidate.id}`,
        debitEntryId: input.direction === 'IN' ? candidate.id : payment.entryId,
        creditEntryId: input.direction === 'IN' ? payment.entryId : candidate.id,
        amount: amount.toFixed(2),
        effectiveAt: input.effectiveAt.toISOString().slice(0, 10),
      })
      remaining = remaining.minus(amount)
    }
    return { ...payment, unallocated: remaining.toFixed(2) }
  })
}

export function allocateCustomerAdvance(db: LedgerDB, ctx: LedgerContext, raw: unknown) {
  const input = commandSchema
    .extend({
      serviceRecordId: z.string().min(1),
      creditEntryId: z.string().min(1),
      amount: moneyText,
      effectiveAt: dateText,
      confirmed: z.literal(true),
    })
    .parse(raw)
  return ledgerCommand(db, ctx, 'customer.advance', input, async (tx) => {
    const balance = await customerBalance(tx, ctx, input.serviceRecordId)
    if (!balance.issued || !balance.partyId) throw new Error('Спочатку виставте рахунок')
    const credit = balance.advances.find((a) => a.id === input.creditEntryId)
    if (!credit || D(credit.remaining).lt(input.amount) || D(balance.debt).lt(input.amount))
      throw new Error('Залишки змінилися. Оновіть розрахунки й перевірте суму зарахування.')
    const nested = {
      $transaction: async (fn: (tx: Tx) => Promise<unknown>) => fn(tx),
    } as unknown as LedgerDB
    let remaining = D(input.amount)
    for (const debit of balance.documents.filter((d) => d.polarity === 'DEBIT')) {
      const amount = D(debit.remaining).lt(remaining) ? D(debit.remaining) : remaining
      if (amount.lte(0)) continue
      await createStockLedger(nested, ctx).allocateSettlement({
        idempotencyKey: 'advance:' + input.idempotencyKey.slice(0, 60) + ':' + debit.id,
        debitEntryId: debit.id,
        creditEntryId: input.creditEntryId,
        amount: amount.toFixed(2),
        effectiveAt: input.effectiveAt.toISOString().slice(0, 10),
      })
      remaining = remaining.minus(amount)
    }
    return { id: input.creditEntryId, amount: input.amount }
  })
}

/** Issue/share/completion paths converge here; a repeated print never creates a second debit. */
export function ensureCustomerInvoice(
  db: LedgerDB,
  ctx: LedgerContext,
  recordId: string,
  day: string
) {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ctx.organizationId},613))`
      const job = await tx.serviceRecord.findFirstOrThrow({
        where: { organizationId: ctx.organizationId, id: recordId },
        include: { vehicle: { select: { customerId: true } } },
      })
      if (job.financeAccountingMode !== 'LEDGER' || job.billedPartyId) return null
      const customerId = job.customerId ?? job.vehicle?.customerId
      if (!customerId) throw new Error('Виберіть платника перед виставленням рахунку')
      const { createFinance } = await import('./finance')
      const nested = {
        $transaction: async (fn: (tx: Tx) => Promise<unknown>) => fn(tx),
      } as unknown as LedgerDB
      return createFinance(nested, ctx).issueCustomerCharge({
        idempotencyKey: 'issue:' + job.id,
        serviceRecordId: job.id,
        customerId,
        effectiveAt: day,
        dueDate: day,
      })
    },
    { maxWait: 10000, timeout: 20000 }
  )
}

/** Recurring writers run without an interactive session; the actor cannot sign in. */
export async function chargeCompletedRecord(
  tx: Tx,
  organizationId: string,
  record: { id: string; status: string; financeAccountingMode: string },
  userId?: string
) {
  if (record.status !== 'completed' || record.financeAccountingMode !== 'LEDGER') return
  let actor = userId
  if (!actor) {
    const { createHash } = await import('node:crypto')
    const id =
      'ledger-recurring-' + createHash('sha256').update(organizationId).digest('hex').slice(0, 24)
    actor = (
      await tx.user.upsert({
        where: { id },
        create: { id, name: 'Ledger recurring invoices', email: id + '@internal.invalid' },
        update: {},
      })
    ).id
  }
  const nested = {
    $transaction: async (fn: (tx: Tx) => Promise<unknown>) => fn(tx),
  } as unknown as LedgerDB
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date())
  await ensureCustomerInvoice(nested, { organizationId, userId: actor }, record.id, day)
}
