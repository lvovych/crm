import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
const mocks = vi.hoisted(() => ({ save: vi.fn(), push: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}))
vi.mock('@/components/service-type-context', () => ({ useServiceType: () => 'automotive' }))
vi.mock('@/features/calendar/Actions/quickBookingActions', () => ({
  createQuickBooking: mocks.save,
}))
vi.mock('@/features/workboard/Actions/technicianActions', () => ({
  getTechnicians: async () => ({ success: true, data: [{ id: 't1', name: 'Mechanic One' }] }),
}))
vi.mock('@/features/workboard/Actions/workBayActions', () => ({
  getWorkBays: async () => ({ success: true, data: [{ id: 'b1', name: 'Bay One' }] }),
}))
vi.mock('@/components/vehicle-picker-dialog', () => ({ VehiclePickerDialog: () => null }))
import { QuickBookingDialog } from '@/features/calendar/Components/QuickBookingDialog'
const vehicles = [
  {
    id: 'v1',
    make: 'Toyota',
    model: 'Camry',
    year: 2023,
    licensePlate: 'AC1234AA',
    vin: 'VIN1234567890',
    customer: { id: 'c1', company: null, name: 'Anna Jones', phone: '+380671234567' },
  },
]
function setup() {
  const saved = vi.fn(),
    closed = vi.fn()
  render(
    <QuickBookingDialog
      open
      onOpenChange={closed}
      date="2026-11-09"
      time="10:30"
      vehicles={vehicles}
      customers={[]}
      onSaved={saved}
    />
  )
  return { saved, closed }
}
async function selectVehicle() {
  fireEvent.click(await screen.findByRole('button', { name: /AC1234AA.*Toyota/i }))
  fireEvent.change(screen.getByLabelText('Reason for visit'), { target: { value: 'Brakes' } })
}
describe('quick booking form', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.save.mockResolvedValue({ success: true, data: { id: 'job1' } })
  })
  it('selects a vehicle, carries clicked date/time and saves without leaving the calendar', async () => {
    const { saved, closed } = setup()
    await selectVehicle()
    expect(screen.getByLabelText('Start time')).toHaveValue('10:30')
    expect(screen.getByLabelText('Date')).toHaveValue('2026-11-09')
    fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '90' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save booking' }))
    await waitFor(() => expect(saved).toHaveBeenCalledWith('job1', '2026-11-09'))
    expect(closed).toHaveBeenCalledWith(false)
    expect(mocks.push).not.toHaveBeenCalled()
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        vehicleId: 'v1',
        reason: 'Brakes',
        time: '10:30',
        duration: 90,
        requestId: expect.any(String),
      })
    )
  })
  it('opens the created work order only when requested', async () => {
    setup()
    await selectVehicle()
    fireEvent.click(screen.getByLabelText('Open work order after saving'))
    fireEvent.click(screen.getByRole('button', { name: 'Save booking' }))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/vehicles/v1/service/job1'))
  })
  it('blocks double submission and closing while the request is pending', async () => {
    let finish!: (value: unknown) => void
    mocks.save.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    const { closed } = setup()
    await selectVehicle()
    const button = screen.getByRole('button', { name: 'Save booking' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(mocks.save).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' })
    expect(closed).not.toHaveBeenCalled()
    finish({ success: true, data: { id: 'job1' } })
    await waitFor(() => expect(closed).toHaveBeenCalledWith(false))
  })
  it('keeps fields and the request token on error so retry cannot duplicate a saved booking', async () => {
    mocks.save.mockResolvedValueOnce({ success: false })
    setup()
    await selectVehicle()
    fireEvent.click(screen.getByRole('button', { name: 'Save booking' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save')
    expect(screen.getByLabelText('Reason for visit')).toHaveValue('Brakes')
    fireEvent.click(screen.getByRole('button', { name: 'Save booking' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2))
    expect(mocks.save.mock.calls[0][0].requestId).toBe(mocks.save.mock.calls[1][0].requestId)
  })
  it('cancel creates nothing', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /AC1234AA.*Toyota/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
