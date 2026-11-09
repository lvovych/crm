import type { TxClient } from '@/lib/db'
import { draftSchema, transitionReceipt } from './ledger'
import { articleKey, matchArticle } from './articles'
import { storedLineAmount } from './money'

// Called only inside the caller's transaction; a failed line or posting rolls back new cards too.
export async function saveReceiptDraft(
  tx: TxClient,
  organizationId: string,
  userId: string,
  input: unknown,
  post: boolean,
  canCreatePart: boolean
) {
  const d = draftSchema.parse(input)

  // Serialize receipt-driven catalogue creation across suppliers in this workshop.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId}, 8812))::text`
  const supplier = await tx.counterparty.findFirst({
    where: {
      id: d.supplierId,
      organizationId,
      isArchived: false,
      supplierProfile: { isNot: null },
    },
  })
  if (!supplier) throw new Error('Оберіть активного постачальника.')
  const fields = {
    supplierId: d.supplierId,
    number: d.number,
    documentDate: d.documentDate,
    receivedDate: d.receivedDate,
  }
  const existing = await tx.supplierReceipt.findFirst({
    where: {
      organizationId,
      supplierId: d.supplierId,
      number: d.number,
      documentDate: d.documentDate,
    },
  })
  if (existing && (existing.id !== d.id || d.version === 0))
    return { id: existing.id, duplicate: existing.id !== d.id }
  if (d.version === 0)
    await tx.supplierReceipt.create({
      data: { id: d.id, organizationId, createdById: userId, ...fields },
    })
  else {
    const changed = await tx.supplierReceipt.updateMany({
      where: { id: d.id, organizationId, version: d.version, status: 'draft' },
      data: { ...fields, version: { increment: 1 } },
    })
    if (!changed.count) throw new Error('Документ змінився. Оновіть сторінку.')
    await tx.supplierReceiptLine.deleteMany({ where: { receiptId: d.id } })
  }
  const parts = await tx.inventoryPart.findMany({
    where: {
      organizationId,
      isArchived: false,
    },
    select: {
      id: true,
      unit: true,
      brandId: true,
      partNumber: true,
      supplierArticles: {
        where: { supplierId: d.supplierId },
        select: { supplierId: true, normalized: true },
      },
    },
  })
  const lines = []
  for (const [position, line] of d.lines.entries()) {
    let partId: string | null = null
    const article = line.kind === 'part' ? line.article?.trim() : null
    if (line.kind === 'part') {
      if (!article || !articleKey(article)) throw new Error('Вкажіть артикул кожного товару.')
      const matches = matchArticle(parts, d.supplierId, article, line.brandId)
      if (matches.length > 1)
        throw new Error(
          'Знайдено кілька карток. Уточніть бренд або перевірте дублікати в довіднику товарів.'
        )
      let selected = matches[0]
      if (line.partId && selected?.id !== line.partId)
        throw new Error('Зіставлення товару змінилося. Перевірте рядок.')
      if (!selected) {
        if (!canCreatePart)
          throw new Error('Для нового товару потрібен дозвіл на створення складських карток.')
        const brandId = line.brandId || 'brand_unknown'
        const brand = await tx.brand.findFirst({ where: { id: brandId, isActive: true } })
        if (!brand) throw new Error('Оберіть активний бренд.')
        selected = await tx.inventoryPart.create({
          data: {
            organizationId,
            userId,
            name: line.name,
            partNumber: article,
            brandId,
            unit: line.unit,
            unitCost: Number(line.unitPrice),
            quantity: 0,
          },
          select: {
            id: true,
            unit: true,
            brandId: true,
            partNumber: true,
            supplierArticles: { select: { supplierId: true, normalized: true } },
          },
        })
        parts.push(selected)
      }
      if ((selected.unit || 'шт') !== line.unit)
        throw new Error('Одиниця виміру товару змінилася. Перевірте рядок.')
      partId = selected.id
    }
    const { brandId: _brandId, ...storedLine } = line
    lines.push({
      ...storedLine,
      article,
      partId,
      receiptId: d.id,
      position,
      amount: storedLineAmount(line),
    })
  }
  await tx.supplierReceiptLine.createMany({ data: lines })
  if (post) await transitionReceipt(tx, organizationId, userId, d.id, d.version + 1, 'posted', '')
  return { id: d.id, duplicate: false }
}
