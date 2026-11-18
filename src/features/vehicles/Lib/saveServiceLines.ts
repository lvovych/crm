import { lineMatcher } from './lineMatcher'
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
  const key = (p: {
    name: string
    partNumber?: string | null
    quantity: number
    unitPrice: number
  }) => JSON.stringify([p.name, p.partNumber ?? '', p.quantity, p.unitPrice])
  const match = lineMatcher(previous, key)
  return lines.map((line, sortOrder) => {
    const old = match(line.id, key(line))
    if (line.id && !old) throw new Error('Позицію вже змінено. Оновіть наряд перед збереженням.')
    const next = {
      ...line,
      id: old?.id,
      payrollSellerId: old?.payrollSellerId ?? null,
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
    ? await tx.serviceLabor.findMany({
        where: { serviceRecordId: recordId },
        include: { subcontract: true },
      })
    : []
  const key = (l: { description: string; hours: number; rate: number; total: number }) =>
    JSON.stringify([l.description, l.hours, l.rate, l.total])
  const match = lineMatcher(previous, key)
  const ids = [
    ...new Set([...lines, ...previous].flatMap((l) => (l.technicianId ? [l.technicianId] : []))),
  ]
  const supplierIds = [...new Set(lines.flatMap((l) => (l.supplierId ? [l.supplierId] : [])))]
  const suppliers = supplierIds.length
    ? await tx.counterparty.findMany({
        where: { organizationId, id: { in: supplierIds }, supplierProfile: { isNot: null } },
      })
    : []
  const technicians = ids.length
    ? await tx.technician.findMany({ where: { organizationId, id: { in: ids } } })
    : []
  const bySupplier = new Map(suppliers.map((s) => [s.id, s]))
  const byTechnician = new Map(technicians.map((t) => [t.id, t]))
  const normalized = lines.map((line, sortOrder) => {
    const old = match(line.id, key(line))
    if (line.id && !old) throw new Error('Послугу вже змінено. Оновіть наряд перед збереженням.')
    const supplier = bySupplier.get(line.supplierId ?? '')
    if (
      line.supplierId &&
      (!supplier ||
        (supplier.isArchived && old?.subcontract?.supplierId !== supplier.id) ||
        line.technicianId ||
        !line.purchasePrice ||
        line.pricingType === 'shopFee' ||
        line.hours <= 0 ||
        !/^\d{1,9}(\.\d{1,3})?$/.test(String(line.hours)))
    )
      throw new Error('Перевірте підрядника, закупівельну ціну та кількість.')
    if (
      old?.subcontract?.receiptLineId &&
      (old.subcontract.supplierId !== line.supplierId ||
        old.hours !== line.hours ||
        !old.subcontract.unitCost.equals(line.purchasePrice ?? -1))
    ) {
      throw new Error('Закупівля вже пов’язана з накладною. Перевірте документ.')
    }
    const technicianId = supplier
      ? null
      : line.technicianId === undefined
        ? (old?.technicianId ?? null)
        : line.technicianId
    const changed = technicianId !== (old?.technicianId ?? null)
    if (technicianId) {
      const technician = byTechnician.get(technicianId ?? '')
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
      executorName: supplier
        ? supplier.name
        : old?.subcontract
          ? null
          : changed
            ? (byTechnician.get(technicianId ?? '')?.name ?? null)
            : (old?.executorName ?? byTechnician.get(technicianId ?? '')?.name ?? null),
      executorFrozen: supplier
        ? true
        : old?.subcontract
          ? false
          : changed
            ? false
            : (old?.executorFrozen ?? false),
      executorLegacy: changed ? false : (old?.executorLegacy ?? false),
    }
  })
  const retainedSubcontracts = new Set(
    normalized.flatMap((l, i) => (lines[i].supplierId ? [l.id] : []))
  )
  const removed = previous.filter((p) => p.subcontract && !retainedSubcontracts.has(p.id))
  if (removed.some((p) => p.subcontract?.receiptLineId))
    throw new Error('Не можна видалити роботу з накладною.')
  if (removed.length)
    await tx.subcontractWork.deleteMany({ where: { laborId: { in: removed.map((p) => p.id) } } })
  return normalized
}

export async function saveSubcontracts(
  tx: TxClient,
  lines: ServiceLaborInput[],
  saved: { id?: string }[]
) {
  for (const [i, line] of lines.entries()) {
    if (!line.supplierId) continue
    const laborId = saved[i].id!
    const data = { supplierId: line.supplierId, unitCost: line.purchasePrice! }
    await tx.subcontractWork.upsert({
      where: { laborId },
      create: { laborId, ...data },
      update: data,
    })
  }
}
