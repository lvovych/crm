import { returnReasons } from './return-reasons'
import type { TxClient } from '@/lib/db'
import { columnsOf } from '@/lib/backup/rows'

/** Accept legacy single-receipt exports and independent consolidated returns. */
export async function restoreSupplierReturn(
  tx: TxClient,
  organizationId: string,
  userId: string,
  raw: Record<string, unknown>
) {
  const receipt = raw.receiptId
    ? await tx.supplierReceipt.findFirstOrThrow({
        where: { id: String(raw.receiptId), organizationId },
      })
    : null
  const supplierId = raw.supplierId ? String(raw.supplierId) : receipt?.supplierId
  if (!supplierId || (receipt && receipt.supplierId !== supplierId))
    throw new Error('Invalid return supplier')
  await tx.counterparty.findFirstOrThrow({ where: { id: supplierId, organizationId } })
  const { lines, ...fields } = raw
  if (!Array.isArray(lines) || !lines.length) throw new Error('Empty supplier return')
  for (const line of lines as Record<string, unknown>[])
    await tx.supplierReceiptLine.findFirstOrThrow({
      where: { id: String(line.lineId), receipt: { organizationId, supplierId } },
    })
  await tx.supplierReturn.create({
    data: columnsOf(fields, {
      organizationId,
      supplierId,
      receiptId: receipt?.id ?? null,
      createdById: userId,
      reason: returnReasons.find((reason) => reason === fields.reason) ?? 'Інше',
    }) as never,
  })
  for (const line of lines as Record<string, unknown>[])
    await tx.supplierReturnLine.create({ data: columnsOf(line, { returnId: raw.id }) as never })
}
