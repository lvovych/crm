import { z } from 'zod'
import { Prisma } from '@/generated/prisma/client'
import type { TxClient } from '@/lib/db'

export const RETURN_PAGE_SIZE = 25
export const returnSearchSchema = z.object({
  q: z.string().trim().max(120).default(''),
  page: z.coerce.number().int().min(1).max(100000).default(1),
})
export const returnListSchema = returnSearchSchema
  .extend({
    supplier: z.string().max(100).optional(),
    status: z.enum(['', 'draft', 'posted']).optional(),
    from: z.union([z.literal(''), z.string().date()]).optional(),
    to: z.union([z.literal(''), z.string().date()]).optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, 'Перевірте період.')

export type ReturnOption = {
  id: string
  name: string
  brand: string
  article: string
  kind: string
  receiptId: string
  receiptNumber: string
  receiptDate: string
  unit: string
  unitPrice: string
  originalQuantity: string
  originalAmount: string
  returnedQuantity: string
  returnedAmount: string
  available: string
}
type SearchDb = Pick<TxClient, '$queryRaw'>
// Escape LIKE metacharacters: an article containing % or _ is a literal search.
export function literalSearch(q: string) {
  return q.replace(/[\\%_]/g, (char) => String.fromCharCode(92) + char)
}
function pattern(q: string) {
  return '%' + literalSearch(q) + '%'
}

/** Filter availability in PostgreSQL BEFORE LIMIT; exhausted pages never hide later stock.
 * Consumption mirrors currentTransferred: surviving matching row, restored/deleted row,
 * or conservative historical transfer when an order/replacement still consumes the item.
 */
export async function readReturnOptions(
  db: SearchDb,
  org: string,
  supplier: string,
  today: string,
  raw: { q?: string; page?: number } = {},
  selectedIds: string[] = []
) {
  const { q, page } = returnSearchSchema.parse(raw)
  const selected = z.array(z.string().min(1).max(100)).max(200).parse(selectedIds)
  const eligible = Prisma.sql`r.status='posted' AND r."receivedDate"<=${today}::date
    AND e.id IS NOT NULL AND e."reversedAt" IS NULL AND e.date<=${today}::date`
  const search = q
    ? Prisma.sql`AND (
    l.name ILIKE ${pattern(q)} OR COALESCE(NULLIF(l.article,''),p."partNumber",'') ILIKE ${pattern(q)}
    OR COALESCE(b.name,'') ILIKE ${pattern(q)} OR r.number ILIKE ${pattern(q)}
  )`
    : Prisma.empty
  async function query(pinned: boolean) {
    if (pinned && !selected.length) return []
    return db.$queryRaw<ReturnOption[]>(Prisma.sql`
      SELECT l.id, l.name, COALESCE(b.name,'') AS brand,
        COALESCE(NULLIF(l.article,''),p."partNumber",'') AS article, l.kind,
        r.id AS "receiptId", r.number AS "receiptNumber", to_char(r."documentDate",'YYYY-MM-DD') AS "receiptDate",
        l.unit, l."unitPrice"::text AS "unitPrice", l.quantity::text AS "originalQuantity",
        l.amount::text AS "originalAmount", ret.quantity::text AS "returnedQuantity",
        ret.amount::text AS "returnedAmount", trunc(av.quantity,3)::text AS available
      FROM "public"."supplier_receipt_lines" l
      JOIN "public"."supplier_receipts" r ON r.id=l."receiptId"
      LEFT JOIN "public"."supplier_entries" e ON e."receiptId"=r.id AND e."organizationId"=${org}
      LEFT JOIN "public"."inventory_parts" p ON p.id=l."partId" AND p."organizationId"=${org}
      LEFT JOIN "public"."brands" b ON b.id=p."brandId"
      CROSS JOIN LATERAL (
        SELECT COALESCE(SUM(rl.quantity),0) AS quantity, COALESCE(SUM(rl.amount),0) AS amount
        FROM "public"."supplier_return_lines" rl JOIN "public"."supplier_returns" d ON d.id=rl."returnId"
        WHERE rl."lineId"=l.id AND d.status='posted' AND d."organizationId"=${org}
      ) ret
      CROSS JOIN LATERAL (
        SELECT COALESCE(SUM(CASE
          WHEN sp.id IS NOT NULL AND sp."inventoryPartId"=l."partId"
            THEN LEAST(t.quantity,GREATEST(0,sp.quantity::numeric))
          WHEN sr.id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM "public"."service_parts" replacement
            WHERE replacement."serviceRecordId"=sr.id AND replacement."inventoryPartId"=l."partId"
          ) THEN 0 ELSE t.quantity END),0) AS quantity
        FROM "public"."receipt_transfers" t
        LEFT JOIN "public"."service_records" sr ON sr.id=t."serviceRecordId" AND sr."organizationId"=${org}
        LEFT JOIN "public"."service_parts" sp ON sp.id=t."servicePartId" AND sp."serviceRecordId"=sr.id
        WHERE t."lineId"=l.id
      ) sent
      CROSS JOIN LATERAL (
        SELECT CASE WHEN ${eligible} THEN GREATEST(0,
          LEAST(l.quantity-ret.quantity-sent.quantity,
            CASE WHEN l.kind='part' THEN COALESCE(p.quantity,0)::numeric ELSE l.quantity END)
        ) ELSE 0 END AS quantity
      ) av
      WHERE r."organizationId"=${org} AND r."supplierId"=${supplier}
        ${pinned ? Prisma.sql`AND l.id IN (${Prisma.join(selected)})` : Prisma.sql`AND ${eligible} AND av.quantity>=0.001 ${search}`}
      ORDER BY r."receivedDate" DESC, r.id ASC, l.position ASC, l.id ASC
      LIMIT ${pinned ? 200 : RETURN_PAGE_SIZE + 1}
      OFFSET ${pinned ? 0 : (page - 1) * RETURN_PAGE_SIZE}
    `)
  }
  const [rows, selectedLines] = await Promise.all([query(false), query(true)])
  return {
    lines: rows.slice(0, RETURN_PAGE_SIZE),
    selectedLines,
    page,
    hasMore: rows.length > RETURN_PAGE_SIZE,
    q,
  }
}

export async function readReturnList(
  db: Pick<TxClient, 'supplierReturn' | 'supplierReturnLine'>,
  org: string,
  raw: unknown = {}
) {
  const f = returnListSchema.parse(raw)
  const where: Prisma.SupplierReturnWhereInput = {
    organizationId: org,
    ...(f.supplier ? { supplierId: f.supplier } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.from || f.to
      ? {
          date: {
            ...(f.from ? { gte: new Date(f.from + 'T00:00:00Z') } : {}),
            ...(f.to ? { lte: new Date(f.to + 'T00:00:00Z') } : {}),
          },
        }
      : {}),
    ...(f.q
      ? {
          OR: [
            { number: { contains: literalSearch(f.q), mode: 'insensitive' } },
            { supplierDocumentNumber: { contains: literalSearch(f.q), mode: 'insensitive' } },
            { supplier: { name: { contains: literalSearch(f.q), mode: 'insensitive' } } },
          ],
        }
      : {}),
  }
  const total = await db.supplierReturn.count({ where })
  const pages = Math.max(1, Math.ceil(total / RETURN_PAGE_SIZE))
  const page = Math.min(f.page, pages)
  const documents = await db.supplierReturn.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    skip: (page - 1) * RETURN_PAGE_SIZE,
    take: RETURN_PAGE_SIZE,
    select: {
      id: true,
      number: true,
      supplierDocumentNumber: true,
      date: true,
      status: true,
      supplierId: true,
      supplier: { select: { name: true } },
    },
  })
  const totals = documents.length
    ? await db.supplierReturnLine.groupBy({
        by: ['returnId'],
        where: { returnId: { in: documents.map((d) => d.id) } },
        _sum: { amount: true },
      })
    : []
  const amounts = new Map(totals.map((d) => [d.returnId, d._sum.amount?.toFixed(2) ?? '0.00']))
  return {
    page,
    pages,
    total,
    documents: documents.map((d) => ({
      ...d,
      supplier: d.supplier.name,
      date: d.date.toISOString().slice(0, 10),
      amount: amounts.get(d.id) ?? '0.00',
    })),
  }
}
