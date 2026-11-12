import { randomUUID } from 'node:crypto'
import type { TxClient } from '@/lib/db'
import { assertEditable, invoiceLockState, type DocumentLockSettings } from '@/lib/document-lock'
import { workshopDay } from '@/features/settlements/amounts'
import { storedLineAmount } from './money'
import { refreshOrderTotals } from './transfer-ledger'

async function lockOrder(tx: TxClient, organizationId: string, id: string) {
  await tx.$queryRaw`SELECT id FROM "public"."service_records" WHERE id=${id} AND "organizationId"=${organizationId} FOR UPDATE`
  return tx.serviceRecord.findFirstOrThrow({
    where: { organizationId, id },
    include: { payments: { select: { amount: true } } },
  })
}

export async function draftSubcontractReceipts(
  tx: TxClient,
  organizationId: string,
  userId: string,
  orderId: string
) {
  const order = await lockOrder(tx, organizationId, orderId)
  const works = await tx.subcontractWork.findMany({
    where: { labor: { serviceRecordId: orderId } },
    include: { labor: true, supplier: true, receiptLine: { select: { receiptId: true } } },
    orderBy: { labor: { sortOrder: 'asc' } },
  })
  const receipts = new Set<string>()
  const drafts = new Map<string, { id: string; position: number }>()
  for (const work of works) {
    if (work.receiptLine) {
      receipts.add(work.receiptLine.receiptId)
      continue
    }
    if (work.supplier.isArchived || work.supplier.organizationId !== organizationId)
      throw new Error('Перевірте постачальника.')
    let draft = drafts.get(work.supplierId)
    if (!draft) {
      const id = randomUUID()
      const date = new Date(workshopDay() + 'T00:00:00Z')
      await tx.supplierReceipt.create({
        data: {
          id,
          organizationId,
          supplierId: work.supplierId,
          createdById: userId,
          number: 'НЗ-' + (order.invoiceNumber || order.id).slice(0, 65) + '-' + id.slice(0, 8),
          documentDate: date,
          receivedDate: date,
        },
      })
      draft = { id, position: 0 }
      drafts.set(work.supplierId, draft)
      receipts.add(id)
    }
    const price = { quantity: String(work.labor.hours), unitPrice: work.unitCost.toString() }
    const line = await tx.supplierReceiptLine.create({
      data: {
        receiptId: draft.id,
        position: draft.position++,
        kind: 'service',
        name: work.labor.description,
        unit: work.labor.pricingType === 'hourly' ? 'год' : 'посл.',
        ...price,
        amount: storedLineAmount(price),
      },
    })
    await tx.subcontractWork.update({
      where: { laborId: work.laborId },
      data: { receiptLineId: line.id },
    })
  }
  return [...receipts]
}

export async function assignReceiptService(
  tx: TxClient,
  organizationId: string,
  orderId: string,
  lineId: string,
  laborId: string | null,
  sale: string,
  settings: DocumentLockSettings
) {
  const order = await lockOrder(tx, organizationId, orderId)
  await tx.$queryRaw`SELECT r.id FROM "public"."supplier_receipts" r JOIN "public"."supplier_receipt_lines" l ON l."receiptId"=r.id WHERE l.id=${lineId} AND r."organizationId"=${organizationId} FOR UPDATE`
  const line = await tx.supplierReceiptLine.findFirstOrThrow({
    where: { id: lineId, kind: 'service', receipt: { organizationId, status: 'posted' } },
    include: {
      receipt: { include: { supplier: true } },
      subcontract: { include: { labor: true } },
    },
  })
  if (line.subcontract) {
    if (
      line.subcontract.labor.serviceRecordId === orderId &&
      (!laborId || laborId === line.subcontract.laborId)
    )
      return
    throw new Error('Послугу вже віднесено до іншої роботи.')
  }
  const supplierId = line.receipt.supplierId
  if (laborId) {
    const work = await tx.subcontractWork.findFirstOrThrow({
      where: { laborId, supplierId, receiptLineId: null, labor: { serviceRecordId: orderId } },
      include: { labor: true },
    })
    if (!line.quantity.equals(work.labor.hours))
      throw new Error('Кількість у наряді й накладній має збігатися.')
    await tx.subcontractWork.update({
      where: { laborId },
      data: { receiptLineId: line.id, unitCost: line.unitPrice },
    })
  } else {
    assertEditable(invoiceLockState(order, settings))
    if (['completed', 'cancelled', 'canceled'].includes(order.status))
      throw new Error('Оберіть відкритий наряд.')
    const total = storedLineAmount({ quantity: line.quantity.toString(), unitPrice: sale })
    const last = await tx.serviceLabor.aggregate({
      where: { serviceRecordId: orderId },
      _max: { sortOrder: true },
    })
    await tx.serviceLabor.create({
      data: {
        serviceRecordId: orderId,
        pricingType: 'service',
        description: line.name,
        hours: line.quantity.toNumber(),
        rate: Number(sale),
        total: Number(total),
        executorFrozen: true,
        executorName: line.receipt.supplier.name,
        sortOrder: (last._max.sortOrder ?? -1) + 1,
        subcontract: { create: { supplierId, unitCost: line.unitPrice, receiptLineId: lineId } },
      },
    })
    await refreshOrderTotals(tx, order)
  }
}
