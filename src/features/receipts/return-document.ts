import type { Prisma } from '@/generated/prisma/client'
export const returnDocumentInclude = {
  supplier: true,
  lines: { include: { line: { include: { receipt: true, part: { include: { brand: true } } } } } },
} satisfies Prisma.SupplierReturnInclude
export function serializeReturn(
  d: Prisma.SupplierReturnGetPayload<{ include: typeof returnDocumentInclude }>
) {
  return {
    id: d.id,
    status: d.status,
    version: d.version,
    number: d.number,
    date: d.date.toISOString().slice(0, 10),
    reason: d.reason,
    supplierDocumentNumber: d.supplierDocumentNumber,
    supplierId: d.supplierId,
    supplier: d.supplier.name,
    lines: d.lines.map((l) => ({
      id: l.id,
      lineId: l.lineId,
      name: l.line.name,
      brand: l.brandSnapshot ?? l.line.part?.brand.name ?? '',
      article: l.articleSnapshot ?? l.line.article ?? l.line.part?.partNumber ?? '',
      receiptId: l.line.receiptId,
      receiptNumber: l.line.receipt.number,
      receiptDate: l.line.receipt.documentDate.toISOString().slice(0, 10),
      unit: l.line.unit,
      unitPrice: l.line.unitPrice.toString(),
      quantity: l.quantity.toString(),
      amount: l.amount.toFixed(2),
    })),
  }
}
