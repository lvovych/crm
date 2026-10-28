import { createHash, randomUUID } from 'node:crypto'
import { Prisma } from '@/generated/prisma/client'
import { parsePurchaseFile, normalizeArticle, type ImportMapping, type PreviewRow } from './imports'
import { ledgerCommand, metadata, type LedgerContext, type LedgerDB } from './transaction'
import { saveReceiptDraftTx } from './service'
import { receiptSchema, commandSchema } from './contracts'
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
    taskLease?: { id: string; attempt: number }
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
        input.taskLease &&
        !(await tx.ledgerImportTask.findFirst({
          where: {
            id: input.taskLease.id,
            organizationId: ctx.organizationId,
            status: 'RUNNING',
            attempts: input.taskLease.attempt,
            leaseUntil: { gt: new Date() },
          },
        }))
      )
        throw new Error('Обробку вже передано іншому процесу')
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
   WHERE p."organizationId"=${ctx.organizationId} AND p."isArchived"=false
   UNION
   SELECT p.id,w.article,w.brand FROM "public"."supplier_products" sp
   JOIN "public"."inventory_parts" p ON p.id=sp."inventoryPartId" AND p."organizationId"=sp."organizationId"
   JOIN "public"."brands" b ON b.id=p."brandId"
   JOIN jsonb_to_recordset(${JSON.stringify(pairs)}::jsonb) AS w(article text,brand text)
    ON regexp_replace(upper(normalize(COALESCE(sp."supplierArticle",''),NFKC)),'[[:space:]./_-]','','g')=w.article AND lower(normalize(b.name,NFKC))=w.brand
   WHERE sp."organizationId"=${ctx.organizationId} AND sp."supplierId"=${input.supplierId} AND sp."archivedAt" IS NULL AND p."isArchived"=false`
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
      expectedRevision: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
      warehouseId: z.string().min(1),
      effectiveAt: z.iso.date(),
      externalNumber: z.string().trim().min(1).max(100),
      externalDate: z.iso.date(),
      dueDate: z.iso.date(),
    })
    .parse(raw)
  return ledgerCommand(
    db,
    ctx,
    'import.commit',
    { ...input, idempotencyKey: 'import:' + input.jobId },
    async (tx) => {
      const job = await tx.ledgerImportJob.findFirst({
        where: { organizationId: ctx.organizationId, id: input.jobId },
      })
      if (!job) throw new Error('Імпорт не знайдений')
      if (job.documentId) return { id: job.documentId, status: 'DRAFT' }
      const data = job.mapping as unknown as ImportData
      if (input.expectedRevision && input.expectedRevision !== importRevision(data))
        throw new Error('Імпорт уже змінено. Оновіть попередній перегляд перед створенням чернетки')
      if (data.rows.some((r) => r.errors.length || !r.inventoryPartId))
        throw new Error('Виправте всі помилки та виберіть товари перед створенням чернетки')
      const products = await tx.inventoryPart.findMany({
        where: {
          organizationId: ctx.organizationId,
          id: { in: data.rows.map((r) => r.inventoryPartId!) },
        },
      })
      const unit = (v: string) =>
        ['шт', 'шт.', 'pcs'].includes(v.trim().toLowerCase()) ? 'pcs' : v.trim().toLowerCase()
      for (const row of data.rows) {
        const p = products.find((p) => p.id === row.inventoryPartId)
        if (row.unit && p && unit(row.unit) !== unit(p.unit ?? 'pcs'))
          throw new Error(`Рядок ${row.row}: одиниця файлу не збігається з карткою товару`)
      }
      const document = await saveReceiptDraftTx(
        tx,
        ctx,
        receiptSchema.parse({
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
      )
      await tx.ledgerImportJob.update({ where: { id: job.id }, data: { documentId: document.id } })
      return document
    }
  )
}
export function importRevision(data: Prisma.JsonValue) {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex')
}
export async function resolveImportRow(db: LedgerDB, ctx: LedgerContext, raw: unknown) {
  const input = commandSchema
    .extend({
      jobId: z.string().min(1),
      row: z.number().int().positive(),
      inventoryPartId: z.string().min(1),
      expectedRevision: z.string().length(64),
    })
    .parse(raw)
  return ledgerCommand(db, ctx, 'import.resolve', input, async (tx) => {
    const job = await tx.ledgerImportJob.findFirst({
      where: { organizationId: ctx.organizationId, id: input.jobId },
    })
    if (!job || job.documentId) throw new Error('Імпорт не знайдений або чернетку вже створено')
    if (importRevision(job.mapping) !== input.expectedRevision)
      throw new Error('Зіставлення вже змінено. Оновіть попередній перегляд.')
    const product = await tx.inventoryPart.findFirst({
      where: { organizationId: ctx.organizationId, id: input.inventoryPartId, isArchived: false },
      include: { brand: true },
    })
    if (!product) throw new Error('Товар не знайдений')
    const data = job.mapping as unknown as ImportData,
      row = data.rows.find((r) => r.row === input.row)
    if (!row) throw new Error('Рядок імпорту не знайдений')
    // Only matching errors are cleared. Invalid numbers/formulas still block committing.
    row.inventoryPartId = product.id
    row.errors = row.errors.filter(
      (e) =>
        !['Товар не знайдений у каталозі', 'Кілька товарів з таким артикулом і брендом'].includes(e)
    )
    await tx.ledgerImportJob.update({
      where: { id: job.id },
      data: { mapping: JSON.parse(JSON.stringify(data)) },
    })
    return { id: job.id, row: input.row, productName: product.name, brand: product.brand.name }
  })
}

export function importPage(data: Prisma.JsonValue, page: number) {
  const rows = (data as unknown as ImportData).rows
  return {
    rows: rows.slice((page - 1) * 50, page * 50),
    revision: importRevision(data),
    total: rows.length,
    errorCount: rows.filter((r) => r.errors.length).length,
  }
}
