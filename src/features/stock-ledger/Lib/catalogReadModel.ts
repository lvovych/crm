import { Prisma } from '@/generated/prisma/client'
import type { LedgerDB } from './transaction'
export async function catalogQuantities(db: LedgerDB, organizationId: string, ids: string[]) {
  if (!ids.length) return new Map<string, number>()
  const result = new Map<string, number>()
  for (let offset = 0; offset < ids.length; offset += 1000) {
    const batch = ids.slice(offset, offset + 1000)
    const rows = await db.$transaction(
      (tx) =>
        tx.$queryRaw<
          { id: string; quantity: string }[]
        >`SELECT l."inventoryPartId" AS id,SUM(b."onHandQty")::text AS quantity FROM "public"."stock_lot_balances" b JOIN "public"."stock_lots" l ON l.id=b."lotId" AND l."organizationId"=b."organizationId" WHERE b."organizationId"=${organizationId} AND l."inventoryPartId" IN (${Prisma.join(batch)}) GROUP BY l."inventoryPartId"`
    )
    for (const row of rows) result.set(row.id, Number(row.quantity))
  }
  return result
}
