import { Prisma } from '@/generated/prisma/client'
import type { TxClient } from '@/lib/db'

type Transfer = { servicePartId: string; serviceRecordId: string; quantity: { toString(): string } }
type Line = { id: string; partId: string | null; transfers: Transfer[] }

/** Keep historical transfers intact, but recognize goods restored by reducing
 * the original order line. Deleted rows in a surviving order release their
 * goods only when no replacement row still consumes the same inventory item.
 * Missing orders remain conservative (historical/imported references). */
export async function currentTransferred(
  db: Pick<TxClient, 'servicePart' | 'serviceRecord'>,
  organizationId: string,
  lines: Line[]
) {
  const ids = [...new Set(lines.flatMap((line) => line.transfers.map((t) => t.servicePartId)))]
  const parts = ids.length
    ? await db.servicePart.findMany({
        where: { id: { in: ids }, serviceRecord: { organizationId } },
        select: { id: true, quantity: true, serviceRecordId: true, inventoryPartId: true },
      })
    : []
  const orderIds = [
    ...new Set(lines.flatMap((line) => line.transfers.map((t) => t.serviceRecordId))),
  ]
  const orders = orderIds.length
    ? await db.serviceRecord.findMany({
        where: { id: { in: orderIds }, organizationId },
        select: { id: true, partItems: { select: { inventoryPartId: true } } },
      })
    : []
  const byOrder = new Map(orders.map((order) => [order.id, order]))
  const byId = new Map(parts.map((part) => [part.id, part]))
  return new Map(
    lines.map((line) => [
      line.id,
      line.transfers.reduce((sum, transfer) => {
        const part = byId.get(transfer.servicePartId)
        const original = new Prisma.Decimal(transfer.quantity.toString())
        const consumed =
          part &&
          part.serviceRecordId === transfer.serviceRecordId &&
          part.inventoryPartId === line.partId
            ? Prisma.Decimal.min(original, Prisma.Decimal.max(0, part.quantity))
            : byOrder.has(transfer.serviceRecordId) &&
                !byOrder
                  .get(transfer.serviceRecordId)!
                  .partItems.some((p) => p.inventoryPartId === line.partId)
              ? new Prisma.Decimal(0)
              : original
        return sum.plus(consumed)
      }, new Prisma.Decimal(0)),
    ])
  )
}
