import { D } from './amounts'
import type { Tx, LedgerContext } from './transaction'
export async function reconciliation(tx: Tx, ctx: LedgerContext) {
  const org = { organizationId: ctx.organizationId }
  const balances = await tx.stockLotBalance.findMany({ where: org })
  const movements = await tx.inventoryLedgerEntry.groupBy({
    by: ['lotId', 'warehouseId'],
    where: org,
    _sum: { quantityDelta: true },
  })
  const reservations = await tx.stockReservation.groupBy({
    by: ['lotId', 'warehouseId'],
    where: org,
    _sum: { remainingQuantity: true },
  })
  const movementsByKey = new Map(
    movements.map((m) => [m.lotId + ':' + m.warehouseId, m._sum.quantityDelta ?? D(0)])
  )
  const reservationsByKey = new Map(
    reservations.map((r) => [r.lotId + ':' + r.warehouseId, r._sum.remainingQuantity ?? D(0)])
  )
  const discrepancies = []
  for (const balance of balances) {
    const key = balance.lotId + ':' + balance.warehouseId
    const expected = movementsByKey.get(key) ?? D(0),
      reserved = reservationsByKey.get(key) ?? D(0)
    if (!expected.eq(balance.onHandQty) || !reserved.eq(balance.reservedQty))
      discrepancies.push({
        id: balance.id,
        onHand: balance.onHandQty.toString(),
        expected: expected.toString(),
        reserved: balance.reservedQty.toString(),
        expectedReserved: reserved.toString(),
      })
    movementsByKey.delete(key)
    reservationsByKey.delete(key)
  }
  for (const [id, expected] of movementsByKey)
    if (!expected.isZero())
      discrepancies.push({
        id,
        onHand: '0',
        expected: expected.toString(),
        reserved: '0',
        expectedReserved: (reservationsByKey.get(id) ?? D(0)).toString(),
      })
  return discrepancies
}
export function csvCell(value: unknown) {
  const text = String(value ?? '')
  return '"' + (/^[=+\-@\t\r]/.test(text) ? "'" + text : text).replaceAll('"', '""') + '"'
}
