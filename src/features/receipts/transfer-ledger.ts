import type { TxClient } from '@/lib/db'
import { createHash } from 'node:crypto'
import { Prisma } from '@/generated/prisma/client'
import { transferSchema, availableQuantity, quantityUnits } from './transfer-schema'
import { storedLineAmount } from './money'
import { lockSupplier } from '@/features/settlements/ledger'
import { assertEditable, invoiceLockState, type DocumentLockSettings } from '@/lib/document-lock'
import { refreshShopFeeLines } from '@/features/vehicles/Lib/shopFeeLines'
import { discountAmountFor } from '@/lib/tax'
import { documentTotals } from '@/features/settings/Lib/workshopTax'

export async function transferReceiptGoods(
  tx: TxClient,
  organizationId: string,
  userId: string,
  input: unknown,
  settings: DocumentLockSettings
) {
  const data = transferSchema.parse(input)
  const hash = createHash('sha256')
    .update(
      JSON.stringify({ ...data, lines: [...data.lines].sort((a, b) => a.id.localeCompare(b.id)) })
    )
    .digest('hex')
  const receipt = await tx.supplierReceipt.findFirstOrThrow({
    where: { id: data.receiptId, organizationId },
  })
  await lockSupplier(tx, organizationId, receipt.supplierId)
  await tx.$queryRaw`SELECT id FROM "public"."supplier_receipts" WHERE id=${receipt.id} AND "organizationId"=${organizationId} FOR UPDATE`
  const current = await tx.supplierReceipt.findUniqueOrThrow({
    where: { id: receipt.id },
    include: { lines: { include: { transfers: true } } },
  })
  const prior = await tx.receiptTransfer.findMany({
    where: { requestId: data.requestId, line: { receipt: { organizationId } } },
  })
  if (prior.length) {
    if (prior.length !== data.lines.length || prior.some((p) => p.requestHash !== hash))
      throw new Error('Цей запит уже використано для іншої операції.')
    return {
      serviceRecordId: prior[0].serviceRecordId,
      vehicleId: prior[0].vehicleId,
      count: prior.length,
    }
  }
  if (current.status !== 'posted')
    throw new Error('Передавати товари можна лише з проведеної накладної.')
  await tx.$queryRaw`SELECT id FROM "public"."service_records" WHERE id=${data.serviceRecordId} AND "organizationId"=${organizationId} FOR UPDATE`
  const record = await tx.serviceRecord.findFirstOrThrow({
    where: { id: data.serviceRecordId, organizationId },
    include: { payments: { select: { amount: true } } },
  })
  if (!record.vehicleId || !['pending', 'in-progress', 'waiting-parts'].includes(record.status))
    throw new Error('Оберіть відкритий наряд-замовлення.')
  assertEditable(invoiceLockState(record, settings))
  const sorted = data.lines
    .map((request) => {
      const line = current.lines.find((l) => l.id === request.id)
      if (!line || line.kind !== 'part' || !line.partId)
        throw new Error('Оберіть товари з цієї накладної.')
      const available = availableQuantity(
        line.quantity.toString(),
        line.transfers.map((t) => t.quantity.toString())
      )
      if (quantityUnits(request.quantity) > quantityUnits(available))
        throw new Error(`«${line.name}»: кількість перевищує залишок для передавання.`)
      return { request, line }
    })
    .sort((a, b) => a.line.partId!.localeCompare(b.line.partId!))
  for (const { request, line } of sorted) {
    const stock = await tx.inventoryPart.findFirstOrThrow({
      where: { id: line.partId!, organizationId, isArchived: false },
      include: { brand: true },
    })
    if ((stock.unit?.trim() || 'шт') !== line.unit)
      throw new Error('Одиниця виміру товару змінилася. Перевірте складську картку.')
    const changed = await tx.$queryRaw<{ quantity: number }[]>(
      Prisma.sql`UPDATE "public"."inventory_parts" SET quantity=ROUND((quantity::numeric-${request.quantity}::numeric),3)::float8, "updatedAt"=NOW() WHERE id=${stock.id} AND "organizationId"=${organizationId} AND quantity::numeric>=${request.quantity}::numeric RETURNING quantity`
    )
    if (!changed.length) throw new Error(`«${line.name}»: недостатньо товару на складі.`)
    const part = await tx.servicePart.create({
      data: {
        serviceRecordId: record.id,
        inventoryPartId: stock.id,
        name: line.name,
        brand: stock.brand.name,
        partNumber: line.article,
        unit: line.unit,
        quantity: Number(request.quantity),
        unitPrice: Number(request.unitPrice),
        total: Number(storedLineAmount(request)),
        unitCost: Number(line.unitPrice),
      },
    })
    await tx.receiptTransfer.create({
      data: {
        lineId: line.id,
        requestId: data.requestId,
        requestHash: hash,
        serviceRecordId: record.id,
        serviceRecordLabel: record.invoiceNumber || record.title,
        vehicleId: record.vehicleId,
        servicePartId: part.id,
        quantity: request.quantity,
        unitPrice: request.unitPrice,
        createdById: userId,
      },
    })
    await tx.stockMovement.create({
      data: {
        organizationId,
        inventoryPartId: stock.id,
        delta: -Number(request.quantity),
        quantityAfter: changed[0].quantity,
        reason: 'service_record',
        userId,
        serviceRecordId: record.id,
        serviceRecordLabel: record.invoiceNumber || record.title,
        note: `З накладної № ${current.number}, позиція ${line.position + 1}`,
      },
    })
  }
  await refreshShopFeeLines(tx, record.id, organizationId)
  const [parts, labor] = await Promise.all([
    tx.servicePart.aggregate({ where: { serviceRecordId: record.id }, _sum: { total: true } }),
    tx.serviceLabor.aggregate({ where: { serviceRecordId: record.id }, _sum: { total: true } }),
  ])
  const subtotal = (parts._sum.total || 0) + (labor._sum.total || 0)
  const totals = documentTotals({
    subtotal,
    discountAmount: discountAmountFor(subtotal, record.discountType, record.discountValue),
    taxRate: record.taxRate,
    taxInclusive: record.taxInclusive,
    taxComponents: record.taxComponents,
  })
  await tx.serviceRecord.update({ where: { id: record.id }, data: { subtotal, ...totals } })
  return { serviceRecordId: record.id, vehicleId: record.vehicleId, count: sorted.length }
}
