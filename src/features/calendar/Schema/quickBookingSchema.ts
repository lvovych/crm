import { z } from 'zod'
import { parseWorkshopDateTime } from '@/lib/workshop-datetime'
import { zonedDayKey, zonedParts } from '@/lib/timezone'

export const quickBookingSchema = z.object({
  requestId: z.string().uuid(),
  vehicleId: z.string().min(1),
  reason: z.string().trim().min(1).max(2000),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  duration: z.coerce.number().int().min(15).max(720),
  technicianId: z.string().optional(),
  workBayId: z.string().optional(),
})
export function bookingTimes(date: string, time: string, duration: number, zone: string) {
  const start = parseWorkshopDateTime(`${date}T${time}`, zone)
  const parts = zonedParts(start, zone)
  const clock = `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`
  if (zonedDayKey(start, zone) !== date || clock !== time) throw new Error('Invalid booking time')
  return { start, end: new Date(start.getTime() + duration * 60_000) }
}
