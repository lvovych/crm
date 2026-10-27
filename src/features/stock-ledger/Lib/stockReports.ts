import { Prisma } from '@/generated/prisma/client'
import { z } from 'zod'
import { D } from './amounts'
import type { Tx, LedgerContext } from './transaction'
export const stockFilter = z.object({
  search: z.string().trim().max(100).default(''),
  warehouseId: z.string().default(''),
  page: z.number().int().min(1).max(100000).default(1),
  sort: z.enum(['name', 'available']).default('name'),
  onlyAvailable: z.boolean().default(false),
})
export async function stockSummary(tx: Tx, ctx: LedgerContext, raw: unknown) {
  const input = stockFilter.parse(raw)
  const grouped = Prisma.sql`
    SELECT p.id AS "productId", w.id AS "warehouseId", p.name, p."partNumber" AS article,
      br.name AS brand, p.unit, w.name AS warehouse,
      SUM(b."onHandQty") AS "onHand", SUM(b."reservedQty") AS reserved,
      SUM(b."onHandQty" - b."reservedQty") AS available
    FROM "public"."stock_lot_balances" b
    JOIN "public"."stock_lots" l ON l.id=b."lotId" AND l."organizationId"=b."organizationId"
    JOIN "public"."inventory_parts" p ON p.id=l."inventoryPartId" AND p."organizationId"=b."organizationId"
    JOIN "public"."brands" br ON br.id=p."brandId"
    JOIN "public"."warehouses" w ON w.id=b."warehouseId" AND w."organizationId"=b."organizationId"
    WHERE b."organizationId"=${ctx.organizationId}
      AND (${input.warehouseId}='' OR w.id=${input.warehouseId})
      AND POSITION(LOWER(${input.search}) IN LOWER(CONCAT_WS(' ',p.name,p."partNumber",br.name)))>0
    GROUP BY p.id,w.id,br.name
    HAVING ${input.onlyAvailable} = false OR SUM(b."onHandQty"-b."reservedQty")>0`
  const order =
    input.sort === 'available'
      ? Prisma.sql`available DESC, name, "productId", "warehouseId"`
      : Prisma.sql`name, "productId", "warehouseId"`
  const rows = await tx.$queryRaw<
    Array<{
      productId: string
      warehouseId: string
      name: string
      article: string | null
      brand: string
      unit: string | null
      warehouse: string
      onHand: Prisma.Decimal
      reserved: Prisma.Decimal
      available: Prisma.Decimal
    }>
  >(Prisma.sql`${grouped} ORDER BY ${order} LIMIT 25 OFFSET ${(input.page - 1) * 25}`)
  const count = await tx.$queryRaw<Array<{ total: bigint }>>(
    Prisma.sql`SELECT COUNT(*) AS total FROM (${grouped}) grouped`
  )
  return {
    rows: rows.map((r) => ({
      ...r,
      onHand: D(r.onHand).toFixed(3),
      reserved: D(r.reserved).toFixed(3),
      available: D(r.available).toFixed(3),
    })),
    total: Number(count[0].total),
  }
}
export async function stockHistory(tx: Tx, ctx: LedgerContext, raw: unknown) {
  const input = z
    .object({
      productId: z.string().min(1),
      warehouseId: z.string().min(1),
      page: z.number().int().positive().default(1),
      from: z.iso.date().optional(),
      through: z.iso.date().optional(),
    })
    .parse(raw)
  if (input.from && input.through && input.from > input.through)
    throw new Error('Початкова дата пізніше кінцевої')
  const where = {
    organizationId: ctx.organizationId,
    warehouseId: input.warehouseId,
    lot: { inventoryPartId: input.productId },
    effectiveAt: {
      ...(input.from ? { gte: new Date(input.from) } : {}),
      ...(input.through ? { lte: new Date(input.through) } : {}),
    },
  }
  const rows = await tx.inventoryLedgerEntry.findMany({
    where,
    include: { documentLine: { include: { document: true } } },
    orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    skip: (input.page - 1) * 25,
    take: 25,
  })
  return {
    rows: rows.map((r) => ({
      id: r.id,
      date: r.effectiveAt.toISOString().slice(0, 10),
      number: r.documentLine.document.number,
      kind: r.documentLine.document.kind,
      quantity: r.quantityDelta.toFixed(3),
      lotId: r.lotId,
    })),
    total: await tx.inventoryLedgerEntry.count({ where }),
  }
}
