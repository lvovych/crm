import { randomUUID } from 'node:crypto'
import type { TxClient } from '@/lib/db'
import type { ServiceLaborInput, ServicePartInput } from '../Schema/serviceSchema'
import { discountedPartTotal, partPriceChanged } from './lineDiscount'

export async function prepareParts(
  tx: TxClient,
  recordId: string | null,
  lines: ServicePartInput[]
) {
  const previous = recordId
    ? await tx.servicePart.findMany({ where: { serviceRecordId: recordId } })
    : []
  const used = new Set<string>()
  return lines.map((line, sortOrder) => {
    const old = previous.find(
      (p) =>
        !used.has(p.id) &&
        (line.id
          ? p.id === line.id
          : p.name === line.name &&
            (p.partNumber ?? '') === (line.partNumber ?? '') &&
            p.quantity === line.quantity &&
            p.unitPrice === line.unitPrice)
    )
    if (old) used.add(old.id)
    if (line.id && !old) throw new Error('Позицію вже змінено. Оновіть наряд перед збереженням.')
    const next = {
      ...line,
      id: old?.id,
      sortOrder,
      discountType: line.discountType ?? old?.discountType ?? 'none',
      discountValue: line.discountValue ?? old?.discountValue ?? 0,
    }
    // Validate even metadata edits; recompute only when the price inputs changed.
    const calculated = discountedPartTotal(next)
    return { ...next, total: old && !partPriceChanged(next, old) ? old.total : calculated }
  })
}

export async function prepareLabor(
  tx: TxClient,
  organizationId: string,
  recordId: string | null,
  lines: ServiceLaborInput[]
) {
  const previous = recordId
    ? await tx.serviceLabor.findMany({ where: { serviceRecordId: recordId }, include: { subcontract: true } })
    : []
  const used = new Set<string>()
  const ids = [
    ...new Set([...lines, ...previous].flatMap((l) => (l.technicianId ? [l.technicianId] : []))),
  ]
  const supplierIds = [...new Set(lines.flatMap(l => l.supplierId ? [l.supplierId] : []))]
  const suppliers = supplierIds.length ? await tx.counterparty.findMany({
    where: { organizationId, id: { in: supplierIds }, supplierProfile: { isNot: null } },
  }) : []
  const technicians = ids.length
    ? await tx.technician.findMany({ where: { organizationId, id: { in: ids } } })
    : []
  const normalized = lines.map((line, sortOrder) => {
    const old = previous.find(
      (l) =>
        !used.has(l.id) &&
        (line.id
          ? l.id === line.id
          : l.description === line.description &&
            l.hours === line.hours &&
            l.rate === line.rate &&
            l.total === line.total)
    )
    if (old) used.add(old.id)
    if (line.id && !old) throw new Error('Послугу вже змінено. Оновіть наряд перед збереженням.')
    const supplier = suppliers.find(s => s.id === line.supplierId)
    if (line.supplierId && (!supplier || (supplier.isArchived && old?.subcontract?.supplierId !== supplier.id) ||
      line.technicianId || !line.purchasePrice || line.pricingType === 'shopFee' || line.hours <= 0 ||
      !/^\d{1,9}(\.\d{1,3})?$/.test(String(line.hours)))) throw new Error('Перевірте підрядника, закупівельну ціну та кількість.')
    if (old?.subcontract?.receiptLineId && (old.subcontract.supplierId !== line.supplierId ||
      old.hours !== line.hours || !old.subcontract.unitCost.equals(line.purchasePrice ?? -1))) {
      throw new Error('Закупівля вже пов’язана з накладною. Перевірте документ.')
    }
    const technicianId =
      line.technicianId === undefined ? (old?.technicianId ?? null) : line.technicianId
    const changed = technicianId !== (old?.technicianId ?? null)
    if (technicianId) {
      const technician = technicians.find((t) => t.id === technicianId)
      if (!technician || ((!old || changed) && !technician.isActive))
        throw new Error('Оберіть активного механіка вашої майстерні.')
    }
    return {
      id: old?.id ?? (supplier ? randomUUID() : undefined),
      description: line.description,
      hours: line.hours,
      rate: line.rate,
      total: line.total,
      pricingType: line.pricingType,
      sortOrder,
      technicianId,
      executorName: supplier ? supplier.name : old?.subcontract ? null : changed
        ? (technicians.find((t) => t.id === technicianId)?.name ?? null)
        : (old?.executorName ?? technicians.find((t) => t.id === technicianId)?.name ?? null),
      executorFrozen: supplier ? true : old?.subcontract ? false : changed ? false : (old?.executorFrozen ?? false),
      executorLegacy: changed ? false : (old?.executorLegacy ?? false),
    }
  })
  const removed = previous.filter(p => p.subcontract && !normalized.some((l, i) => l.id === p.id && lines[i].supplierId))
  if (removed.some(p => p.subcontract?.receiptLineId)) throw new Error('Не можна видалити роботу з накладною.')
  if (removed.length) await tx.subcontractWork.deleteMany({ where: { laborId: { in: removed.map(p => p.id) } } })
  return normalized
}

export async function saveSubcontracts(tx: TxClient, lines: ServiceLaborInput[], saved: {id?: string}[]) {
  for (const [i, line] of lines.entries()) {
    if (!line.supplierId) continue
    const laborId = saved[i].id!
    const data = { supplierId: line.supplierId, unitCost: line.purchasePrice! }
    await tx.subcontractWork.upsert({ where: { laborId }, create: { laborId, ...data }, update: data })
  }
}
