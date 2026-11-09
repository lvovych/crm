/**
 * The new work order picker speaks the workshop's language.
 *
 * A marine workshop picks a vessel, adds a vessel, and gives it a registration
 * number rather than a licence plate. An automotive workshop's wording has to
 * stay exactly as it was, because the end-to-end specs find the dialog and its
 * buttons by those words.
 */

import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ServiceTypeProvider } from '@/components/service-type-context'

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))
vi.mock('@/features/vehicles/Actions/vehicleActions', () => ({
  createVehicle: vi.fn(),
  getVehicles: vi.fn(),
}))
vi.mock('@/features/vehicles/Actions/createDraftServiceRecord', () => ({
  createDraftCounterSale: vi.fn(),
}))
vi.mock('@/features/customers/Actions/customerActions', () => ({
  createCustomer: vi.fn(),
  getCustomersList: vi.fn(),
}))
vi.mock('@/features/quotes/Components/CustomerCombobox', () => ({ CustomerCombobox: () => null }))
vi.mock('@/components/upgrade-gate', () => ({ handleGated: () => false }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const { VehiclePickerDialog } = await import('@/components/vehicle-picker-dialog')

const unregistered = {
  id: 'v1',
  make: 'Yamaha',
  model: 'F150',
  year: 2020,
  licensePlate: null,
  customer: null,
}

function renderPicker(serviceType: string, props: { title?: string; empty?: boolean } = {}) {
  return render(
    <ServiceTypeProvider serviceType={serviceType}>
      <VehiclePickerDialog
        open
        onOpenChange={vi.fn()}
        vehicles={props.empty ? [] : [unregistered]}
        customers={[]}
        title={props.title}
      />
    </ServiceTypeProvider>
  )
}

describe('VehiclePickerDialog, automotive', () => {
  it('keeps its vehicle wording on the select step', () => {
    renderPicker('automotive')
    expect(screen.getByRole('dialog', { name: 'Select Vehicle for Work Order' })).toBeVisible()
    expect(screen.getByPlaceholderText('Plate, VIN, make, owner or phone')).toBeInTheDocument()
    expect(screen.getByText('No plate')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add New Vehicle' })).toBeInTheDocument()
  })

  it("uses the caller's title", () => {
    renderPicker('automotive', { title: 'Select Vehicle' })
    expect(screen.getByRole('dialog', { name: 'Select Vehicle' })).toBeVisible()
  })

  it('says no vehicles were found when there are none', () => {
    renderPicker('automotive', { empty: true })
    expect(screen.getByText('No vehicles found.')).toBeInTheDocument()
  })

  it('keeps its vehicle wording on the create step', () => {
    renderPicker('automotive')
    fireEvent.click(screen.getByRole('button', { name: 'Add New Vehicle' }))
    expect(screen.getByRole('dialog', { name: 'Add New Vehicle' })).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Make *' })).toBeVisible()
    expect(screen.getByLabelText('License Plate')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create & Continue' })).toBeInTheDocument()
  })
})

describe('VehiclePickerDialog, marine', () => {
  it('asks for a vessel on the select step, whatever title the caller passed', () => {
    renderPicker('marine', { title: 'Select Vehicle' })
    expect(screen.getByRole('dialog', { name: 'Select Vessel for Work Order' })).toBeVisible()
    expect(screen.getByPlaceholderText('Search vessels...')).toBeInTheDocument()
    expect(screen.getByText('No registration')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add New Vessel' })).toBeInTheDocument()
    expect(screen.queryByText(/vehicle/i)).toBeNull()
  })

  it('says no vessels were found when there are none', () => {
    renderPicker('marine', { empty: true })
    expect(screen.getByText('No vessels found.')).toBeInTheDocument()
  })

  it('asks for what a boat has on the create step', () => {
    renderPicker('marine')
    fireEvent.click(screen.getByRole('button', { name: 'Add New Vessel' }))
    expect(screen.getByRole('dialog', { name: 'Add New Vessel' })).toBeVisible()
    expect(screen.getByLabelText('Manufacturer *')).toHaveAttribute(
      'placeholder',
      'e.g. Boston Whaler'
    )
    expect(screen.getByLabelText('Registration Number')).toBeInTheDocument()
    expect(screen.queryByText('License Plate')).toBeNull()
    expect(screen.getByRole('button', { name: 'Create & Continue' })).toBeInTheDocument()
  })

  it('offers a parts sale without a vessel', () => {
    renderPicker('marine')
    fireEvent.click(screen.getByRole('button', { name: 'Parts-Only Sale' }))
    expect(
      screen.getByText('Create an invoice without a vessel, for over-the-counter parts sales.')
    ).toBeInTheDocument()
  })
})

const owner = { id: 'owner', name: 'Воляник Андрій', company: null, phone: '+380 (67) 987-65-43' }
const cars = [
  {
    ...unregistered,
    id: 'golf',
    make: 'Volkswagen',
    model: 'Golf',
    licensePlate: 'АС1234ВК',
    vin: 'WVWZZZ1KZFW123456',
    customer: owner,
  },
  {
    ...unregistered,
    id: 'passat',
    make: 'Volkswagen',
    model: 'Passat',
    licensePlate: 'АС4321ВК',
    vin: null,
    customer: owner,
  },
  {
    ...unregistered,
    id: 'other',
    make: 'Audi',
    model: 'A4',
    customer: { ...owner, id: 'other-owner', name: 'Петро', phone: '0501112233' },
  },
]

function searchablePicker(extra = {}) {
  return render(
    <ServiceTypeProvider serviceType="automotive">
      <VehiclePickerDialog open onOpenChange={vi.fn()} vehicles={cars} customers={[]} {...extra} />
    </ServiceTypeProvider>
  )
}

describe('VehiclePickerDialog search and selection', () => {
  it.each([
    'Андрій Воляник',
    'Воляник Андрій',
    '0679876543',
    '+380 (67) 987-65-43',
    '6543',
  ])('shows all owner vehicles for %s', (query) => {
    searchablePicker()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: query } })
    expect(screen.getByRole('button', { name: /Volkswagen Golf/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /Volkswagen Passat/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: /Audi/ })).toBeNull()
    expect(screen.getAllByText(/Воляник Андрій.*987-65-43/)).toHaveLength(2)
  })

  it.each([
    'Golf Воляник',
    'AC-1234-BK',
    'wvwzzz1kzfw123456',
  ])('selects the matching vehicle for %s and preserves scheduling context', (query) => {
    router.push.mockClear()
    const onOpenChange = vi.fn()
    searchablePicker({
      onOpenChange,
      redirectQuery: { date: '2026-11-10', technicianId: 'tech-1' },
    })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: query } })
    expect(screen.queryByRole('button', { name: /Volkswagen Passat/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Volkswagen Golf/ }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(router.push).toHaveBeenCalledWith(
      '/vehicles/golf/service/new?date=2026-11-10&technicianId=tech-1'
    )
    expect(screen.getByRole('textbox')).toHaveValue('')
  })

  it('does not accept a short phone suffix and restores all results after clearing', () => {
    searchablePicker()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '543' } })
    expect(screen.queryByRole('button', { name: /Volkswagen/ })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Add New Vehicle' }).length).toBeGreaterThan(0)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } })
    expect(screen.getByRole('button', { name: /Volkswagen Golf/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /Audi/ })).toBeVisible()
  })

  it('recalculates results when vehicle data changes', () => {
    const props = { open: true, onOpenChange: vi.fn(), customers: [], vehicles: cars }
    const { rerender } = render(<VehiclePickerDialog {...props} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '6543' } })
    rerender(<VehiclePickerDialog {...props} vehicles={[cars[2]]} />)
    expect(screen.queryByRole('button', { name: /Volkswagen/ })).toBeNull()
  })
})

describe('NewWorkOrderButton search data integration', () => {
  it('keeps phone and VIN through loading and opening the shared picker', async () => {
    const { getVehicles } = await import('@/features/vehicles/Actions/vehicleActions')
    const { getCustomersList } = await import('@/features/customers/Actions/customerActions')
    const { NewWorkOrderButton } = await import('@/components/new-work-order-button')
    vi.mocked(getVehicles).mockResolvedValue({ success: true, data: cars } as never)
    vi.mocked(getCustomersList).mockResolvedValue({ success: true, data: [] })
    render(
      <ServiceTypeProvider serviceType="automotive">
        <NewWorkOrderButton />
      </ServiceTypeProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'New Work Order' }))
    const search = await screen.findByRole('textbox')
    fireEvent.change(search, { target: { value: '0679876543' } })
    expect(screen.getByRole('button', { name: /Volkswagen Golf/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /Volkswagen Passat/ })).toBeVisible()
    fireEvent.change(search, { target: { value: 'WVWZZZ1KZFW123456' } })
    expect(screen.getByRole('button', { name: /Volkswagen Golf/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: /Volkswagen Passat/ })).toBeNull()
  })
})
