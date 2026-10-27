import { randomUUID } from 'node:crypto'
import { Prisma } from '@/generated/prisma/client'
import { parsePurchaseFile, normalizeArticle, type ImportMapping, type PreviewRow } from './imports'
import { ledgerCommand, metadata, type LedgerContext, type LedgerDB } from './transaction'
import { createStockLedger } from './service'
import { z } from 'zod'
type ImportRow = PreviewRow & { inventoryPartId?: string }
type ImportData = { rows: ImportRow[]; columns: ImportMapping }
export async function previewImport(
  db: LedgerDB,
  ctx: LedgerContext,
  input: {
    supplierId: string
    name: string
    format: 'csv' | 'xlsx'
    bytes: Buffer
    mapping: ImportMapping
  }
) {
  const parsed = await parsePurchaseFile(input.bytes, input.format, input.mapping)
  return ledgerCommand(
    db,
    ctx,
    'import.preview',
    {
      // Preview is refreshable after catalog corrections. Document deduplication uses
      // the persistent (organization, supplier, fileHash) job and commit key.
      idempotencyKey: randomUUID(),
      supplierId: input.supplierId,
      mapping: input.mapping,
    } as { idempotencyKey: string },
    async (tx) => {
      if (
        !(await tx.supplier.findFirst({
          where: { id: input.supplierId, organizationId: ctx.organizationId, archivedAt: null },
        }))
      )
        throw new Error('Постачальник не знайдений')
      const previous = await tx.ledgerImportJob.findUnique({
        where: {
          organizationId_supplierId_fileHash: {
            organizationId: ctx.organizationId,
            supplierId: input.supplierId,
            fileHash: parsed.fileHash,
          },
        },
      })
      if (previous?.documentId)
        return {
          id: previous.id,
          total: previous.rowCount,
          existingDocumentId: previous.documentId,
        }
      const pairs = [
        ...new Map(
          parsed.rows.map((r) => {
            const article = normalizeArticle(r.article),
              brand = r.brand.normalize('NFKC').toLocaleLowerCase('uk')
            return [article + '\0' + brand, { article, brand }]
          })
        ).values(),
      ]
      const products = await tx.$queryRaw<{ id: string; article: string; brand: string }[]>`
   SELECT p.id,w.article,w.brand FROM "public"."inventory_parts" p JOIN "public"."brands" b ON b.id=p."brandId"
   JOIN jsonb_to_recordset(${JSON.stringify(pairs)}::jsonb) AS w(article text,brand text)
    ON regexp_replace(upper(normalize(COALESCE(p."partNumber",''),NFKC)),'[[:space:]./_-]','','g')=w.article
    AND lower(normalize(b.name,NFKC))=w.brand
   WHERE p."organizationId"=${ctx.organizationId} AND p."isArchived"=false`
      const matches = new Map<string, string[]>()
      for (const p of products) {
        const key = p.article + '\0' + p.brand
        matches.set(key, [...(matches.get(key) ?? []), p.id])
      }
      const rows: ImportRow[] = parsed.rows.map((r) => {
        const found =
          matches.get(
            normalizeArticle(r.article) + '\0' + r.brand.normalize('NFKC').toLocaleLowerCase('uk')
          ) ?? []
        return {
          ...r,
          inventoryPartId: found.length === 1 ? found[0] : undefined,
          errors: [
            ...r.errors,
            ...(found.length === 0
              ? ['Товар не знайдений у каталозі']
              : found.length > 1
                ? ['Кілька товарів з таким артикулом і брендом']
                : []),
          ],
        }
      })
      const payload = JSON.parse(
        JSON.stringify({ rows, columns: input.mapping })
      ) as Prisma.InputJsonObject
      const job = previous
        ? await tx.ledgerImportJob.update({
            where: { id: previous.id },
            data: { mapping: payload, rowCount: rows.length },
          })
        : await tx.ledgerImportJob.create({
            data: {
              ...metadata(ctx),
              supplierId: input.supplierId,
              fileHash: parsed.fileHash,
              sourceName: input.name.slice(0, 200),
              rowCount: rows.length,
              mapping: payload,
            },
          })
      return {
        id: job.id,
        total: rows.length,
        errorCount: rows.filter((r) => r.errors.length).length,
      }
    }
  )
}
export async function commitImport(db: LedgerDB, ctx: LedgerContext, raw: unknown) {
  const input = z
    .object({
      jobId: z.string().min(1),
      warehouseId: z.string().min(1),
      effectiveAt: z.iso.date(),
      externalNumber: z.string().trim().min(1).max(100),
      externalDate: z.iso.date(),
      dueDate: z.iso.date(),
    })
    .parse(raw)
  const job = await db.$transaction((tx) =>
    tx.ledgerImportJob.findFirst({ where: { organizationId: ctx.organizationId, id: input.jobId } })
  )
  if (!job) throw new Error('Імпорт не знайдений')
  if (job.documentId) return { id: job.documentId, status: 'DRAFT' }
  const data = job.mapping as unknown as ImportData
  if (data.rows.some((r) => r.errors.length || !r.inventoryPartId))
    throw new Error('Виправте всі помилки у файлі та повторіть попередній перегляд')
  const document = await createStockLedger(db, ctx).saveReceiptDraft({
    ...input,
    supplierId: job.supplierId,
    idempotencyKey: 'import:' + job.id,
    lines: data.rows.map((r) => ({
      inventoryPartId: r.inventoryPartId,
      quantity: r.quantity,
      unitPrice: r.unitPrice,
      discountType: 'AMOUNT',
      discountValue: r.discountValue,
    })),
  })
  await db.$transaction((tx) =>
    tx.ledgerImportJob.update({
      where: { organizationId_id: { organizationId: ctx.organizationId, id: job.id } },
      data: { documentId: document.id },
    })
  )
  return document
}
export function importPage(data: Prisma.JsonValue, page: number) {
  const rows = (data as unknown as ImportData).rows
  return {
    rows: rows.slice((page - 1) * 50, page * 50),
    total: rows.length,
    errorCount: rows.filter((r) => r.errors.length).length,
  }
}
