import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ServiceTypeProvider } from '@/components/service-type-context'
import { createVehicle } from '@/features/vehicles/Actions/vehicleActions'
import { VehiclePickerDialog } from '@/components/vehicle-picker-dialog'

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))
vi.mock('@/features/vehicles/Actions/vehicleActions', () => ({ createVehicle: vi.fn() }))
vi.mock('@/features/vehicles/Actions/createDraftServiceRecord', () => ({
  createDraftCounterSale: vi.fn(),
}))
vi.mock('@/features/customers/Actions/customerActions', () => ({ createCustomer: vi.fn() }))
vi.mock('@/features/quotes/Components/CustomerCombobox', () => ({ CustomerCombobox: () => null }))
vi.mock('@/components/upgrade-gate', () => ({ handleGated: () => false }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const toyota = {
  name: 'Toyota',
  models: [
    {
      name: 'Corolla',
      generations: [
        {
          name: 'Corolla (2019)',
          from: 2019,
          to: null,
          engines: [{ name: '1.8 Hybrid', displacementCc: 1798 }],
        },
      ],
    },
  ],
}
function open() {
  render(
    <ServiceTypeProvider serviceType="automotive">
      <VehiclePickerDialog open onOpenChange={vi.fn()} vehicles={[]} customers={[]} />
    </ServiceTypeProvider>
  )
  fireEvent.click(screen.getAllByRole('button', { name: 'Add New Vehicle' })[0])
}
async function choose(label: string, option: string) {
  fireEvent.click(screen.getByRole('combobox', { name: label }))
  fireEvent.click(await screen.findByRole('option', { name: option }))
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }
  )
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => toyota }))
  vi.mocked(createVehicle).mockResolvedValue({ success: true, data: { id: 'new-car' } } as Awaited<
    ReturnType<typeof createVehicle>
  >)
})
afterEach(() => vi.unstubAllGlobals())

describe('create a work-order vehicle from the catalogue', () => {
  it('saves selected identity, VIN and optional generation/engine before opening the order', async () => {
    open()
    await choose('Make *', 'Toyota')
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    await choose('Model *', 'Corolla')
    await choose('Generation (optional)', 'Corolla (2019)')
    await choose('Engine / modification (optional)', '1.8 Hybrid')
    fireEvent.change(screen.getByLabelText('Year *'), { target: { value: '2020' } })
    fireEvent.change(screen.getByLabelText('VIN'), { target: { value: 'jt d12345678901234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create & Continue' }))
    await waitFor(() =>
      expect(createVehicle).toHaveBeenCalledWith(
        expect.objectContaining({
          make: 'Toyota',
          model: 'Corolla',
          year: 2020,
          vin: 'JTD12345678901234',
          generation: 'Corolla (2019)',
          modification: '1.8 Hybrid',
          engineSize: '1.798',
        })
      )
    )
    expect(push).toHaveBeenCalledWith('/vehicles/new-car/service/new')
  })

  it('clears the model and engine when the make changes', async () => {
    open()
    await choose('Make *', 'Toyota')
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    await choose('Model *', 'Corolla')
    await choose('Generation (optional)', 'Corolla (2019)')
    await choose('Engine / modification (optional)', '1.8 Hybrid')
    await choose('Make *', 'Ford')
    expect(screen.getByRole('combobox', { name: 'Model *' })).toHaveTextContent('Select')
    expect(
      screen.queryByRole('combobox', { name: 'Engine / modification (optional)' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create & Continue' })).toBeDisabled()
  })

  it('allows explicit manual entry even when catalogue loading fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    open()
    await choose('Make *', 'Toyota')
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('combobox', { name: 'Model *' }))
    fireEvent.click(screen.getByRole('button', { name: 'Not listed — enter manually' }))
    fireEvent.change(screen.getByLabelText('Model *'), { target: { value: 'Classic import' } })
    fireEvent.change(screen.getByLabelText('Year *'), { target: { value: '1979' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create & Continue' }))
    await waitFor(() =>
      expect(createVehicle).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'Classic import', year: 1979 })
      )
    )
  })
})
