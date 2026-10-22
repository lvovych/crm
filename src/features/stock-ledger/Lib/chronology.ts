import { D } from './amounts'
import type { LedgerContext, Tx } from './transaction'

/** Backdating against today's projection can create a negative historical balance.
 * Keep lot operations chronological until historical balance revalidation exists. */
export async function assertLotDate(
  tx: Tx,
  ctx: LedgerContext,
  lotId: string,
  date: Date,
  quantity?: string
) {
  const org = { organizationId: ctx.organizationId }
  if (quantity) {
    const lot = await tx.stockLot.findFirstOrThrow({
      where: { ...org, id: lotId },
      include: { sourceLine: { select: { snapshotUnit: true } } },
    })
    if (['pcs', 'шт', 'шт.'].includes(lot.sourceLine.snapshotUnit) && !D(quantity).isInteger())
      throw new Error('Штучний товар потребує цілої кількості')
  }
  const [movement, reservation] = await Promise.all([
    tx.inventoryLedgerEntry.findFirst({
      where: { ...org, lotId },
      orderBy: { effectiveAt: 'desc' },
      select: { effectiveAt: true },
    }),
    tx.reservationEvent.findFirst({
      where: { ...org, reservation: { lotId } },
      orderBy: { effectiveAt: 'desc' },
      select: { effectiveAt: true },
    }),
  ])
  if ((movement && date < movement.effectiveAt) || (reservation && date < reservation.effectiveAt))
    throw new Error(
      'Дата операції передує останньому руху цієї партії. Вкажіть поточну або пізнішу дату руху.'
    )
}
