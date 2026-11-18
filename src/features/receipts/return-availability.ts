import { Prisma } from '@/generated/prisma/client'
import type { TxClient } from '@/lib/db'

type Transfer = { servicePartId: string; serviceRecordId: string; quantity: { toString(): string } }
type Line = { id: string; partId: string | null; transfers: Transfer[] }

/** Keep historical transfers intact, but recognize goods restored by reducing
 * the original order line. Missing/changed references remain conservative. */
export async function currentTransferred(
  db: Pick<TxClient, 'servicePart'>,
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
            : original
        return sum.plus(consumed)
      }, new Prisma.Decimal(0)),
    ])
  )
}
