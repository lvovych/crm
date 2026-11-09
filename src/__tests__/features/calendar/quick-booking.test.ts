import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bookingTimes, quickBookingSchema } from '@/features/calendar/Schema/quickBookingSchema'

const mocks = vi.hoisted(() => ({
  vehicle: vi.fn(),
  existing: vi.fn(),
  update: vi.fn(),
  lock: vi.fn(),
  draft: vi.fn(),
  auth: vi.fn(),
}))
vi.mock('@/lib/db', () => ({
  db: {
    vehicle: { findFirst: mocks.vehicle },
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        $executeRaw: mocks.lock,
        serviceRecord: { findFirst: mocks.existing, update: mocks.update },
      }),
  },
}))
vi.mock('@/lib/with-auth', () => ({
  withAuth: async (fn: (ctx: unknown) => unknown, options: unknown) => {
    mocks.auth(options)
    return fn({ organizationId: 'org1', userId: 'user1' })
  },
}))
vi.mock('@/lib/workshop-timezone', () => ({ workshopTimeZone: async () => 'Europe/Kyiv' }))
vi.mock('@/features/vehicles/Lib/createDraftRecord', () => ({ createDraftRecord: mocks.draft }))
import { createQuickBooking } from '@/features/calendar/Actions/quickBookingActions'

const input = {
  requestId: 'd7b66f98-97d4-4329-8242-44a192a45a95',
  vehicleId: 'v1',
  reason: ' Oil change ',
  date: '2026-11-09',
  time: '09:30',
  duration: 60,
}

describe('quick booking validation and workshop time', () => {
  it('trims the reason and coerces duration', () => {
    expect(quickBookingSchema.parse({ ...input, duration: '45' })).toMatchObject({
      reason: 'Oil change',
      duration: 45,
    })
  })
  it.each([
    { reason: '   ' },
    { reason: 'x'.repeat(2001) },
    { vehicleId: '' },
    { requestId: 'not-uuid' },
    { time: '24:00' },
    { time: '09:60' },
    { duration: 14 },
    { duration: 721 },
    { duration: 30.5 },
    { duration: 'NaN' },
  ])('rejects invalid fields %j', (change) =>
    expect(quickBookingSchema.safeParse({ ...input, ...change }).success).toBe(false))
  it.each([15, 720])('allows duration boundary %s', (duration) =>
    expect(quickBookingSchema.safeParse({ ...input, duration }).success).toBe(true))
  it('stores an instant in the workshop timezone, not the browser timezone', () => {
    const { start, end } = bookingTimes('2026-11-09', '09:30', 60, 'Europe/Kyiv')
    expect(start.toISOString()).toBe('2026-11-09T07:30:00.000Z')
    expect(end.toISOString()).toBe('2026-11-09T08:30:00.000Z')
  })
  it('handles overnight bookings and leap day', () => {
    const { start, end } = bookingTimes('2028-02-29', '23:45', 30, 'UTC')
    expect(start.toISOString()).toBe('2028-02-29T23:45:00.000Z')
    expect(end.toISOString()).toBe('2028-03-01T00:15:00.000Z')
  })
  it.each([
    ['2026-02-29', '12:00'],
    ['2026-04-31', '09:00'],
    ['2026-03-29', '03:30'],
  ])('rejects invalid date or nonexistent DST time %s %s', (date, time) => {
    expect(() => bookingTimes(date, time, 60, 'Europe/Kyiv')).toThrow()
  })
  it('handles an opposite-hemisphere timezone', () => {
    expect(bookingTimes('2026-11-09', '09:30', 60, 'Pacific/Auckland').start.toISOString()).toBe(
      '2026-11-08T20:30:00.000Z'
    )
  })
})

describe('quick booking action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.vehicle.mockResolvedValue({ id: 'v1', customer: { taxExempt: true } })
    mocks.existing.mockResolvedValue(null)
    mocks.draft.mockResolvedValue({ id: `booking_${input.requestId}` })
    mocks.update.mockResolvedValue({ id: `booking_${input.requestId}` })
  })
  it('uses scoped vehicle and existing draft workflow inside the same transaction', async () => {
    await createQuickBooking(input)
    expect(mocks.vehicle).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'v1', organizationId: 'org1' } })
    )
    expect(mocks.draft).toHaveBeenCalledWith(
      { organizationId: 'org1', userId: 'user1' },
      expect.objectContaining({
        id: `booking_${input.requestId}`,
        vehicleId: 'v1',
        customerExempt: true,
        title: null,
        startDateTime: new Date('2026-11-09T07:30Z'),
        endDateTime: new Date('2026-11-09T08:30Z'),
        tx: expect.any(Object),
      })
    )
    expect(mocks.lock).toHaveBeenCalledOnce()
    expect(mocks.auth).toHaveBeenCalledWith(
      expect.objectContaining({ requiredPermissions: [{ action: 'create', subject: 'services' }] })
    )
  })
  it('returns the original booking on retry, without a second draft or notes update', async () => {
    mocks.existing.mockResolvedValue({
      id: 'original',
      vehicleId: 'v1',
      startDateTime: new Date('2026-11-09T07:30Z'),
      endDateTime: new Date('2026-11-09T08:30Z'),
      diagnosticNotes: '<p>Oil change</p>',
    })
    expect(await createQuickBooking(input)).toMatchObject({ id: 'original' })
    expect(mocks.draft).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('rejects token reuse with changed details instead of pretending to save them', async () => {
    mocks.existing.mockResolvedValue({ id: 'original', vehicleId: 'different' })
    await expect(createQuickBooking(input)).rejects.toThrow('already saved')
    expect(mocks.draft).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('rejects a vehicle outside the organization before writing anything', async () => {
    mocks.vehicle.mockResolvedValue(null)
    await expect(createQuickBooking(input)).rejects.toThrow('Vehicle not found')
    expect(mocks.draft).not.toHaveBeenCalled()
  })
  it('escapes HTML in internal notes and forwards selected mechanic and post', async () => {
    await createQuickBooking({
      ...input,
      reason: '<script> & text',
      technicianId: 't1',
      workBayId: 'b1',
    })
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { diagnosticNotes: '<p>&lt;script&gt; &amp; text</p>' } })
    )
    expect(mocks.draft).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ technicianId: 't1', workBayId: 'b1' })
    )
  })
  it('propagates draft validation errors without updating notes', async () => {
    mocks.draft.mockRejectedValueOnce(new Error('Technician not found'))
    await expect(createQuickBooking(input)).rejects.toThrow('Technician not found')
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('does not create a draft for invalid input', async () => {
    await expect(createQuickBooking({ ...input, duration: 0 })).rejects.toThrow()
    expect(mocks.vehicle).not.toHaveBeenCalled()
    expect(mocks.draft).not.toHaveBeenCalled()
  })
})
