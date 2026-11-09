'use server'

import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { PermissionAction, PermissionSubject } from '@/lib/permissions'
import { workshopTimeZone } from '@/lib/workshop-timezone'
import { createDraftRecord } from '@/features/vehicles/Lib/createDraftRecord'
import { bookingTimes, quickBookingSchema } from '../Schema/quickBookingSchema'

export async function createQuickBooking(input: unknown) {
  return withAuth(
    async ({ organizationId, userId }) => {
      const data = quickBookingSchema.parse(input)
      const zone = await workshopTimeZone(organizationId)
      const { start, end } = bookingTimes(data.date, data.time, data.duration, zone)
      const notes = `<p>${data.reason.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`
      const vehicle = await db.vehicle.findFirst({
        where: { id: data.vehicleId, organizationId },
        include: { customer: { select: { taxExempt: true } } },
      })
      if (!vehicle) throw new Error('Vehicle not found')
      return db.$transaction(
        async (tx) => {
          // A retry after a lost response must return the original booking, not create another.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}), hashtext(${data.requestId}))`
          const id = `booking_${data.requestId}`
          const existing = await tx.serviceRecord.findFirst({ where: { id, organizationId } })
          if (existing) {
            if (
              existing.vehicleId !== data.vehicleId ||
              existing.startDateTime?.getTime() !== start.getTime() ||
              existing.endDateTime?.getTime() !== end.getTime() ||
              existing.diagnosticNotes !== notes
            ) {
              throw new Error('This booking request was already saved with different details')
            }
            return existing
          }
          const record = await createDraftRecord(
            { organizationId, userId },
            {
              id,
              vehicleId: vehicle.id,
              customerId: null,
              customerExempt: vehicle.customer?.taxExempt ?? false,
              title: null,
              startDateTime: start,
              endDateTime: end,
              technicianId: data.technicianId || undefined,
              workBayId: data.workBayId || undefined,
              tx,
            }
          )
          return tx.serviceRecord.update({
            where: { id: record.id },
            data: {
              diagnosticNotes: notes,
            },
          })
        },
        { timeout: 15000 }
      )
    },
    {
      requiredPermissions: [
        { action: PermissionAction.CREATE, subject: PermissionSubject.SERVICES },
      ],
      audit: ({ result }) => ({
        action: 'service.create',
        entity: 'ServiceRecord',
        entityId: result.id,
        details: { key: 'service_createDraft', params: { ref: result.invoiceNumber || result.id } },
        metadata: { serviceRecordId: result.id, vehicleId: result.vehicleId },
      }),
    }
  )
}
