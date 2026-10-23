import { D, proportionalAmount } from './amounts'
import type { LedgerContext, Tx } from './transaction'

/** Called under ledgerCommand's organization lock, before inserting the movement.
 * Use carrying value, not rounded unit cost. Moving the final quantity clears the
 * warehouse's exact value; transfers carry that same value into the target.
 */
export async function outgoingCost(
  tx: Tx,
  ctx: LedgerContext,
  lotId: string,
  warehouseId: string,
  quantity: string
) {
  const balance = await tx.inventoryLedgerEntry.aggregate({
    where: { organizationId: ctx.organizationId, lotId, warehouseId },
    _sum: { quantityDelta: true, costAmountDelta: true },
  })
  return proportionalAmount(
    D(balance._sum.costAmountDelta ?? 0).toString(),
    D(balance._sum.quantityDelta ?? 0).toString(),
    '0',
    '0',
    quantity,
    6
  )
}
