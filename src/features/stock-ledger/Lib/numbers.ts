import type { LedgerContext, Tx } from './transaction'
import { metadata } from './transaction'
export async function nextDocumentNumber(
  tx: Tx,
  ctx: LedgerContext,
  kind: string,
  date = new Date()
) {
  const year = date.getUTCFullYear()
  const sequence = await tx.documentSequence.upsert({
    where: { organizationId_kind_year: { organizationId: ctx.organizationId, kind, year } },
    create: { ...metadata(ctx), kind, year, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  })
  return `${kind}-${year}-${String(sequence.nextValue - 1).padStart(6, '0')}`
}
