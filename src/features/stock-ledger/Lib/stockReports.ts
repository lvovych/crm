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
  onlyDeficit: z.boolean().default(false),
  includeArchived: z.boolean().default(false),
  brand: z.string().max(100).default(''),
  category: z.string().max(100).default(''),
  pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]).default(25),
})
export async function stockSummary(tx: Tx, ctx: LedgerContext, raw: unknown) {
  const input = stockFilter.parse(raw)
  const words = input.search.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const matchesWords = words.length
    ? Prisma.join(
        words.map(
          (word) =>
            Prisma.sql`POSITION(${word} IN (p."ledgerSearchText" || ' ' || LOWER(br.name)))>0`
        ),
        ' AND '
      )
    : Prisma.sql`TRUE`
  const normalized = input.search
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[\s./_-]/g, '')
  const matchesArticle = normalized
    ? Prisma.sql`POSITION(${normalized} IN p."ledgerArticleKey")>0`
    : Prisma.sql`FALSE`
  const grouped = Prisma.sql`
    WITH balances AS (
      SELECT l."inventoryPartId" AS product, b."warehouseId" AS warehouse,
       SUM(b."onHandQty") AS hand,SUM(b."reservedQty") AS reserved
      FROM "public"."stock_lot_balances" b JOIN "public"."stock_lots" l ON l.id=b."lotId" AND l."organizationId"=b."organizationId"
      WHERE b."organizationId"=${ctx.organizationId} GROUP BY l."inventoryPartId",b."warehouseId"
    ), received AS (
      SELECT l."purchaseOrderLineId" AS line,SUM(l.quantity) AS qty FROM "public"."inventory_document_lines" l
      JOIN "public"."inventory_documents" d ON d.id=l."documentId" AND d."organizationId"=l."organizationId"
      WHERE l."organizationId"=${ctx.organizationId} AND d.kind='RECEIPT' AND d.status='POSTED' AND l."purchaseOrderLineId" IS NOT NULL GROUP BY l."purchaseOrderLineId"
    ), incoming AS (
      SELECT l."inventoryPartId" AS product,o."warehouseId" AS warehouse,SUM(GREATEST(l."qtyOrdered"-l."qtyCancelled"-COALESCE(r.qty,0),0)) AS qty
      FROM "public"."purchase_order_lines" l JOIN "public"."purchase_orders" o ON o.id=l."orderId" AND o."organizationId"=l."organizationId"
      LEFT JOIN received r ON r.line=l.id
      WHERE l."organizationId"=${ctx.organizationId} AND o.status IN ('CONFIRMED','PARTIALLY_RECEIVED') GROUP BY l."inventoryPartId",o."warehouseId"
    ), keys AS (
      SELECT p.id AS product,w.id AS warehouse FROM "public"."inventory_parts" p CROSS JOIN "public"."warehouses" w WHERE p."organizationId"=${ctx.organizationId} AND w."organizationId"=${ctx.organizationId} AND w."isDefault"
      UNION ALL SELECT b.product,b.warehouse FROM balances b JOIN "public"."warehouses" w ON w.id=b.warehouse AND w."organizationId"=${ctx.organizationId} WHERE NOT w."isDefault"
      UNION ALL SELECT i.product,i.warehouse FROM incoming i JOIN "public"."warehouses" w ON w.id=i.warehouse AND w."organizationId"=${ctx.organizationId} WHERE NOT w."isDefault" AND NOT EXISTS(SELECT 1 FROM balances b WHERE b.product=i.product AND b.warehouse=i.warehouse)
    )
    SELECT p.id AS "productId",w.id AS "warehouseId",p.name,p."partNumber" AS article,br.name AS brand,p.unit,w.name AS warehouse,
      COALESCE(b.hand,0) AS "onHand",COALESCE(b.reserved,0) AS reserved,COALESCE(b.hand-b.reserved,0) AS available,
      COALESCE(i.qty,0) AS expected,CASE WHEN w."isDefault" THEN p."minQuantity"::numeric ELSE 0 END AS minimum,
      GREATEST((CASE WHEN w."isDefault" THEN p."minQuantity"::numeric ELSE 0 END)-COALESCE(b.hand-b.reserved,0)-COALESCE(i.qty,0),0) AS deficit
    FROM keys k JOIN "public"."inventory_parts" p ON p.id=k.product AND p."organizationId"=${ctx.organizationId}
    JOIN "public"."warehouses" w ON w.id=k.warehouse AND w."organizationId"=${ctx.organizationId}
    JOIN "public"."brands" br ON br.id=p."brandId" LEFT JOIN balances b ON b.product=p.id AND b.warehouse=w.id LEFT JOIN incoming i ON i.product=p.id AND i.warehouse=w.id
    WHERE (${input.warehouseId}='' OR w.id=${input.warehouseId})
      AND (${input.includeArchived} OR (NOT p."isArchived" AND w."archivedAt" IS NULL))
      AND POSITION(LOWER(${input.brand}) IN LOWER(br.name))>0
      AND POSITION(LOWER(${input.category}) IN LOWER(COALESCE(p.category,'')))>0
      AND ((${matchesWords}) OR (${matchesArticle}))
      AND (NOT ${input.onlyAvailable} OR COALESCE(b.hand-b.reserved,0)>0)
      AND (NOT ${input.onlyDeficit} OR (CASE WHEN w."isDefault" THEN p."minQuantity"::numeric ELSE 0 END)>COALESCE(b.hand-b.reserved,0)+COALESCE(i.qty,0))`

  const order =
    input.sort === 'available'
      ? Prisma.sql`available DESC, name, "productId", "warehouseId"`
      : Prisma.sql`name, "productId", "warehouseId"`
  const rows = await tx.$queryRaw<
    Array<{
      total: bigint
      sumHand: string
      sumReserved: string
      sumAvailable: string
      sumExpected: string
      productId: string
      warehouseId: string
      name: string
      article: string | null
      brand: string
      unit: string | null
      warehouse: string
      onHand: Prisma.Decimal
      reserved: Prisma.Decimal
      expected: Prisma.Decimal
      minimum: Prisma.Decimal
      deficit: Prisma.Decimal
      available: Prisma.Decimal
    }>
  >(
    Prisma.sql`SELECT q.*,COUNT(*) OVER() AS total,SUM("onHand") OVER()::text AS "sumHand",SUM(reserved) OVER()::text AS "sumReserved",SUM(available) OVER()::text AS "sumAvailable",SUM(expected) OVER()::text AS "sumExpected" FROM (${grouped}) q ORDER BY ${order} LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}`
  )
  const count = rows.length
    ? [
        {
          total: rows[0].total,
          onHand: rows[0].sumHand,
          reserved: rows[0].sumReserved,
          available: rows[0].sumAvailable,
          expected: rows[0].sumExpected,
        },
      ]
    : await tx.$queryRaw<
        Array<{
          total: bigint
          onHand: string
          reserved: string
          available: string
          expected: string
        }>
      >(
        Prisma.sql`SELECT COUNT(*) AS total,COALESCE(SUM("onHand"),0)::text AS "onHand",COALESCE(SUM(reserved),0)::text AS reserved,COALESCE(SUM(available),0)::text AS available,COALESCE(SUM(expected),0)::text AS expected FROM (${grouped}) q`
      )
  return {
    rows: rows.map(
      ({
        total: _total,
        sumHand: _hand,
        sumReserved: _reserved,
        sumAvailable: _available,
        sumExpected: _expected,
        ...r
      }) => ({
        ...r,
        expected: D(r.expected).toFixed(3),
        minimum: D(r.minimum).toFixed(3),
        deficit: D(r.deficit).toFixed(3),
        onHand: D(r.onHand).toFixed(3),
        reserved: D(r.reserved).toFixed(3),
        available: D(r.available).toFixed(3),
      })
    ),
    total: Number(count[0].total),
    totals: {
      onHand: count[0].onHand,
      reserved: count[0].reserved,
      available: count[0].available,
      expected: count[0].expected,
    },
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
  // Limit each lot before merging: a heavily used lot must not sort its entire journal for page one.
  const ids = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT e.id FROM "public"."stock_lots" l CROSS JOIN LATERAL (
      SELECT e.id,e."effectiveAt",e."createdAt" FROM "public"."inventory_ledger_entries" e
      WHERE e."organizationId"=${ctx.organizationId} AND e."lotId"=l.id AND e."warehouseId"=${input.warehouseId}
      ${input.from ? Prisma.sql`AND e."effectiveAt">=${new Date(input.from)}` : Prisma.empty}
      ${input.through ? Prisma.sql`AND e."effectiveAt"<=${new Date(input.through)}` : Prisma.empty}
      ORDER BY e."effectiveAt" DESC,e."createdAt" DESC,e.id DESC LIMIT ${input.page * 25}
    ) e WHERE l."organizationId"=${ctx.organizationId} AND l."inventoryPartId"=${input.productId}
    ORDER BY e."effectiveAt" DESC,e."createdAt" DESC,e.id DESC LIMIT 25 OFFSET ${(input.page - 1) * 25}`)
  const found = await tx.inventoryLedgerEntry.findMany({
    where: { organizationId: ctx.organizationId, id: { in: ids.map((r) => r.id) } },
    include: {
      createdBy: { select: { name: true } },
      documentLine: {
        include: {
          document: true,
          documentLotAllocation_documentLine: {
            select: { demand: { select: { serviceRecordId: true } } },
          },
        },
      },
    },
  })
  const byId = new Map(found.map((r) => [r.id, r]))
  const rows = ids.map((r) => byId.get(r.id)!)
  return {
    rows: rows.map((r) => ({
      id: r.id,
      date: r.effectiveAt.toISOString().slice(0, 10),
      number: r.documentLine.document.number,
      kind: r.documentLine.document.kind,
      quantity: r.quantityDelta.toFixed(3),
      lotId: r.lotId,
      actor: r.createdBy?.name ?? 'Система',
      serviceRecordIds: [
        ...new Set(
          r.documentLine.documentLotAllocation_documentLine.flatMap((a) =>
            a.demand ? [a.demand.serviceRecordId] : []
          )
        ),
      ],
    })),
    total: await tx.inventoryLedgerEntry.count({ where }),
  }
}
