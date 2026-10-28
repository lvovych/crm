import { z } from 'zod'
import { paymentSchema, postSchema } from './contracts'
import { ledgerCommand, metadata, type LedgerDB, type LedgerContext } from './transaction'
import { postMoneyTransactionTx } from './service'
export function paymentDraftOperations(db: LedgerDB, ctx: LedgerContext) {
  const org = { organizationId: ctx.organizationId }
  return {
    async save(raw: unknown) {
      const input = paymentSchema
        .extend({
          documentId: z.string().optional(),
          expectedVersion: z.number().int().positive().optional(),
        })
        .parse(raw)
      return ledgerCommand(db, ctx, 'payment.draft', input, async (tx) => {
        await tx.settlementParty.findFirstOrThrow({ where: { ...org, id: input.partyId } })
        await tx.cashAccount.findFirstOrThrow({
          where: { ...org, id: input.accountId, archivedAt: null },
        })
        const data = {
          partyId: input.partyId,
          accountId: input.accountId,
          direction: input.direction,
          amount: input.amount,
          effectiveAt: input.effectiveAt,
          method: input.method,
          note: input.note,
        }
        if (input.documentId) {
          const previous = await tx.moneyTransaction.findFirst({
            where: {
              ...org,
              id: input.documentId,
              status: 'DRAFT',
              version: input.expectedVersion ?? -1,
            },
          })
          if (!previous) throw new Error('Чернетку вже змінено або проведено')
          await tx.moneyTransaction.update({
            where: { id: previous.id },
            data: { ...data, version: { increment: 1 } },
          })
          return { id: previous.id, version: previous.version + 1, status: 'DRAFT' }
        }
        const draft = await tx.moneyTransaction.create({
          data: { ...metadata(ctx), ...data, status: 'DRAFT' },
        })
        return { id: draft.id, version: draft.version, status: 'DRAFT' }
      })
    },
    async post(raw: unknown) {
      const input = postSchema.parse(raw)
      return ledgerCommand(db, ctx, 'payment.draft.post', input, async (tx) => {
        const draft = await tx.moneyTransaction.findFirst({
          where: { ...org, id: input.documentId, status: 'DRAFT', version: input.expectedVersion },
        })
        if (!draft) throw new Error('Чернетку вже змінено або проведено')
        return postMoneyTransactionTx(
          tx,
          ctx,
          paymentSchema.parse({
            ...draft,
            idempotencyKey: input.idempotencyKey,
            amount: draft.amount.toString(),
            effectiveAt: draft.effectiveAt.toISOString().slice(0, 10),
            note: draft.note ?? '',
          }),
          draft.id
        )
      })
    },
    async cancel(raw: unknown) {
      const input = postSchema.parse(raw)
      return ledgerCommand(db, ctx, 'payment.draft.cancel', input, async (tx) => {
        const r = await tx.moneyTransaction.updateMany({
          where: { ...org, id: input.documentId, status: 'DRAFT', version: input.expectedVersion },
          data: { status: 'CANCELLED', version: { increment: 1 } },
        })
        if (!r.count) throw new Error('Чернетку вже змінено')
        return { id: input.documentId, status: 'CANCELLED' }
      })
    },
  }
}
