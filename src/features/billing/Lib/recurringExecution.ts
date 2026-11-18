import { db } from '@/lib/db'
import { nextInvoiceNumber } from '@/lib/invoice-number.server'
import { workshopTimeZone } from '@/lib/workshop-timezone'
import { shiftWorkshopTime } from '@/lib/workshop-datetime'
import { recurringTotals } from './recurringTotals'

export function calculateNextRunDate(current: Date, frequency: string, timeZone: string): Date {
  switch (frequency) {
    case 'weekly':
      return shiftWorkshopTime(current, { days: 7 }, timeZone)
    case 'biweekly':
      return shiftWorkshopTime(current, { days: 14 }, timeZone)
    case 'monthly':
      return shiftWorkshopTime(current, { months: 1 }, timeZone)
    case 'quarterly':
      return shiftWorkshopTime(current, { months: 3 }, timeZone)
    case 'yearly':
      return shiftWorkshopTime(current, { years: 1 }, timeZone)
    default:
      throw new Error('Unknown recurring invoice frequency')
  }
}
export async function executeRecurringInvoice(
  candidate: { id: string; nextRunDate: Date },
  organizationId: string,
  now: Date
) {
  const zone = await workshopTimeZone(organizationId)
  return db.$transaction(
    async (tx) => {
      // A retry carries the observed due date. Re-reading after the lock prevents
      // both duplicates and accidentally processing another overdue period.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${candidate.id}), hashtext('recurring-invoice'))`
      const ri = await tx.recurringInvoice.findFirst({
        where: {
          id: candidate.id,
          vehicle: { organizationId },
          isActive: true,
          nextRunDate: candidate.nextRunDate,
        },
        include: { templateParts: true, templateLabor: true },
      })
      if (!ri || ri.nextRunDate > now) return null
      const nextRunDate = calculateNextRunDate(ri.nextRunDate, ri.frequency, zone)
      const invoiceNumber = await nextInvoiceNumber(tx, organizationId, zone, now)
      const { parts, labor, ...totals } = recurringTotals({
        ...ri,
        templateParts: ri.templateParts.map(({ name, partNumber, quantity, unitPrice }) => ({
          name,
          partNumber,
          quantity,
          unitPrice,
        })),
        templateLabor: ri.templateLabor.map(({ description, hours, rate, pricingType }) => ({
          description,
          hours,
          rate,
          pricingType,
        })),
      })
      const record = await tx.serviceRecord.create({
        data: {
          customerLedgerTracked: true,
          organizationId,
          title: ri.title,
          description: ri.description,
          type: ri.type,
          status: 'completed',
          serviceDate: now,
          startDateTime: now,
          invoiceNotes: ri.invoiceNotes,
          taxRate: ri.taxRate,
          taxInclusive: ri.taxInclusive,
          invoiceNumber,
          vehicleId: ri.vehicleId,
          ...totals,
          partItems: { create: parts },
          laborItems: { create: labor },
        },
        select: { id: true },
      })
      await tx.recurringInvoice.update({
        where: { id: ri.id },
        data: {
          lastRunAt: now,
          runCount: { increment: 1 },
          nextRunDate,
          ...(ri.endDate && nextRunDate > ri.endDate ? { isActive: false } : {}),
        },
      })
      return record
    },
    { timeout: 15000 }
  )
}
