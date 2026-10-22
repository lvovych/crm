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
      stockOwnership: line.stockOwnership ?? (old?.stockOwnership as 'OWN' | 'CUSTOMER' | undefined) ?? 'OWN',
      customerPartInstalled: line.customerPartInstalled ?? old?.customerPartInstalled ?? false,
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
    ? await tx.serviceLabor.findMany({ where: { serviceRecordId: recordId } })
    : []
  const used = new Set<string>()
  const ids = [
    ...new Set([...lines, ...previous].flatMap((l) => (l.technicianId ? [l.technicianId] : []))),
  ]
  const technicians = ids.length
    ? await tx.technician.findMany({ where: { organizationId, id: { in: ids } } })
    : []
  return lines.map((line, sortOrder) => {
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
    const technicianId =
      line.technicianId === undefined ? (old?.technicianId ?? null) : line.technicianId
    const changed = technicianId !== (old?.technicianId ?? null)
    if (technicianId) {
      const technician = technicians.find((t) => t.id === technicianId)
      if (!technician || ((!old || changed) && !technician.isActive))
        throw new Error('Оберіть активного механіка вашої майстерні.')
    }
    return {
      id: old?.id,
      description: line.description,
      hours: line.hours,
      rate: line.rate,
      total: line.total,
      pricingType: line.pricingType,
      sortOrder,
      technicianId,
      executorName: changed
        ? (technicians.find((t) => t.id === technicianId)?.name ?? null)
        : (old?.executorName ?? technicians.find((t) => t.id === technicianId)?.name ?? null),
      executorFrozen: changed ? false : (old?.executorFrozen ?? false),
      executorLegacy: changed ? false : (old?.executorLegacy ?? false),
    }
  })
}
