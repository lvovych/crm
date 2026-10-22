import { reversalSchema } from './contracts'
import {
  assertPeriod,
  ledgerCommand,
  metadata,
  type LedgerDB,
  type LedgerContext,
  type Tx,
} from './transaction'
export async function unallocate(
  tx: Tx,
  ctx: LedgerContext,
  id: string,
  date: Date,
  reason: string
) {
  const allocation = await tx.settlementAllocation.findFirst({
    where: { organizationId: ctx.organizationId, id, reversedAt: null },
  })
  if (!allocation) throw new Error('Активне рознесення не знайдене')
  if (date < allocation.effectiveAt) throw new Error('Сторно не може передувати рознесенню')
  await tx.settlementAllocation.update({
    where: { id },
    data: { reversedAt: date, reversalReason: reason },
  })
  return allocation
}
export function createSettlementOperations(db: LedgerDB, ctx: LedgerContext) {
  const org = { organizationId: ctx.organizationId },
    meta = metadata(ctx)
  return {
    async reverseAllocation(raw: unknown) {
      const input = reversalSchema.parse(raw)
      return ledgerCommand(db, ctx, 'allocation.reverse', input, async (tx) => {
        await assertPeriod(tx, ctx, input.effectiveAt, false)
        const allocation = await unallocate(tx, ctx, input.id, input.effectiveAt, input.reason)
        return { id: allocation.id, amount: allocation.amount.toFixed(2), reason: input.reason }
      })
    },
    async reversePayment(raw: unknown) {
      const input = reversalSchema.parse(raw)
      return ledgerCommand(db, ctx, 'payment.reverse', input, async (tx) => {
        await assertPeriod(tx, ctx, input.effectiveAt, false)
        const original = await tx.moneyTransaction.findFirst({
          where: { ...org, id: input.id, status: 'POSTED', reversalOfId: null },
        })
        if (!original) throw new Error('Проведений платіж не знайдений')
        if (input.effectiveAt < original.effectiveAt)
          throw new Error('Сторно не може передувати платежу')
        const entry = await tx.settlementEntry.findFirstOrThrow({
          where: { ...org, moneyTransactionId: original.id },
        })
        const allocations = await tx.settlementAllocation.findMany({
          where: {
            ...org,
            reversedAt: null,
            OR: [{ debitEntryId: entry.id }, { creditEntryId: entry.id }],
          },
        })
        for (const allocation of allocations)
          await unallocate(tx, ctx, allocation.id, input.effectiveAt, input.reason)
        const direction = original.direction === 'IN' ? 'OUT' : 'IN'
        const payment = await tx.moneyTransaction.create({
          data: {
            ...meta,
            reversalOfId: original.id,
            partyId: original.partyId,
            accountId: original.accountId,
            direction,
            amount: original.amount,
            effectiveAt: input.effectiveAt,
            method: 'reversal',
            note: `${original.id}: ${input.reason}`,
          },
        })
        await tx.cashLedgerEntry.create({
          data: {
            ...meta,
            accountId: original.accountId,
            moneyTransactionId: payment.id,
            amountDelta: original.amount.mul(direction === 'IN' ? 1 : -1),
            effectiveAt: input.effectiveAt,
            operationKey: 'reversal:' + original.id,
          },
        })
        const counter = await tx.settlementEntry.create({
          data: {
            ...meta,
            reversalOfId: entry.id,
            partyId: entry.partyId,
            side: entry.side,
            polarity: entry.polarity === 'DEBIT' ? 'CREDIT' : 'DEBIT',
            amount: entry.amount,
            effectiveAt: input.effectiveAt,
            moneyTransactionId: payment.id,
            operationKey: 'reversal:' + entry.id,
          },
        })
        await tx.settlementAllocation.create({
          data: {
            ...meta,
            debitEntryId: entry.polarity === 'DEBIT' ? entry.id : counter.id,
            creditEntryId: entry.polarity === 'CREDIT' ? entry.id : counter.id,
            amount: entry.amount,
            effectiveAt: input.effectiveAt,
            operationKey: 'reversal:' + original.id,
          },
        })
        await tx.moneyTransaction.update({
          where: { id: original.id },
          data: { status: 'REVERSED', version: { increment: 1 } },
        })
        return {
          id: payment.id,
          reversedId: original.id,
          amount: original.amount.toFixed(2),
          reason: input.reason,
        }
      })
    },
  }
}
