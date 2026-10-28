import { z } from 'zod'
import { commandSchema, dateText } from './contracts'
import { moneyText, D } from './amounts'
import { allocated, createStockLedger } from './service'
import { ledgerCommand, type LedgerDB, type LedgerContext, type Tx } from './transaction'
const schema = commandSchema
  .extend({
    creditEntryId: z.string().min(1),
    effectiveAt: dateText,
    lines: z
      .array(z.object({ debitEntryId: z.string().min(1), amount: moneyText }))
      .min(1)
      .max(100),
  })
  .refine(
    (i) => new Set(i.lines.map((l) => l.debitEntryId)).size === i.lines.length,
    'Документ повторюється'
  )
export async function suggestAllocation(tx: Tx, ctx: LedgerContext, creditId: string) {
  const org = { organizationId: ctx.organizationId }
  const credit = await tx.settlementEntry.findFirstOrThrow({
    where: { ...org, id: creditId, polarity: 'CREDIT' },
  })
  let available = credit.amount.minus(await allocated(tx, ctx, credit.id, 'CREDIT'))
  const original = available
  const debits = await tx.settlementEntry.findMany({
    where: {
      ...org,
      partyId: credit.partyId,
      side: credit.side,
      currency: credit.currency,
      polarity: 'DEBIT',
    },
    orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { effectiveAt: 'asc' }, { id: 'asc' }],
    include: {
      customerAdjustment: { select: { number: true } },
      inventoryDocument: { select: { number: true, externalNumber: true } },
      supplierServiceDocument: { select: { number: true } },
      serviceRecord: { select: { title: true } },
    },
  })
  const lines = []
  for (const debit of debits) {
    const remaining = debit.amount.minus(await allocated(tx, ctx, debit.id, 'DEBIT'))
    if (remaining.lte(0)) continue
    const amount = remaining.lt(available) ? remaining : available
    available = available.minus(amount)
    lines.push({
      debitEntryId: debit.id,
      label:
        debit.customerAdjustment?.number ??
        debit.inventoryDocument?.externalNumber ??
        debit.inventoryDocument?.number ??
        debit.supplierServiceDocument?.number ??
        debit.serviceRecord?.title ??
        'Початковий баланс',
      dueDate: debit.dueDate?.toISOString().slice(0, 10) ?? null,
      date: debit.effectiveAt.toISOString().slice(0, 10),
      remaining: remaining.toFixed(2),
      amount: amount.toFixed(2),
    })
  }
  return {
    creditEntryId: credit.id,
    available: original.toFixed(2),
    unallocated: available.toFixed(2),
    creditDate: credit.effectiveAt.toISOString().slice(0, 10),
    lines,
  }
}
export async function allocateBatch(db: LedgerDB, ctx: LedgerContext, raw: unknown) {
  const input = schema.parse(raw)
  return ledgerCommand(db, ctx, 'settlement.allocateBatch', input, async (tx) => {
    const nested = {
      $transaction: async (fn: (tx: Tx) => Promise<unknown>) => fn(tx),
    } as unknown as LedgerDB
    const service = createStockLedger(nested, ctx),
      ids: string[] = []
    for (const [index, line] of input.lines.entries()) {
      const result = await service.allocateSettlement({
        ...line,
        creditEntryId: input.creditEntryId,
        effectiveAt: input.effectiveAt.toISOString().slice(0, 10),
        idempotencyKey: input.idempotencyKey.slice(0, 80) + ':' + index,
      })
      ids.push(result.id)
    }
    return {
      id: input.creditEntryId,
      allocationIds: ids,
      total: input.lines.reduce((sum, l) => sum.plus(l.amount), D(0)).toFixed(2),
    }
  })
}
