import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JobFactsCard } from '@/features/vehicles/Components/service-page/modern/JobFactsCard'
import type { ComponentProps } from 'react'
vi.mock('@/features/quotes/Components/VehicleCombobox', () => ({
  VehicleCombobox: () => <button type="button">Vehicle picker</button>,
}))
vi.mock('@/components/date-settings-context', () => ({
  useDateSettings: () => ({ timezone: 'Europe/Kyiv', dateFormat: 'dd/MM/yyyy', timeFormat: '24h' }),
}))
afterEach(cleanup)
beforeEach(() => localStorage.clear())
const customer = { id: 'customer', name: 'Anna Client', email: 'anna@example.test', phone: '+380501234567' }
const vehicle = { id: 'car', year: 2020, make: 'Toyota', model: 'Camry', vin: 'VIN123456789', licensePlate: 'AC1234AA', customer, purchasePrice: 35500, purchaseDate: '2023-03-15', color: 'Black' }
function show(locked = false, hasVehicle = true) {
  const props = {
    record: { customer, vehicle: hasVehicle ? vehicle : null },
    initialData: { mileage: 12345 }, vehicleName: 'Toyota Camry',
    selectedVehicleId: hasVehicle ? 'car' : null, setSelectedVehicleId: vi.fn(), techName: '', locked,
  } as unknown as ComponentProps<typeof JobFactsCard>
  return render(<JobFactsCard {...props} />)
}
describe('work order customer and vehicle summary', () => {
  it('keeps name, phone, VIN, plate and mileage visible without secondary information', () => {
    show()
    expect(screen.getByRole('link', { name: 'Anna Client' })).toHaveAttribute('href', '/customers/customer')
    expect(screen.getByRole('link', { name: customer.phone })).toHaveAttribute('href', `tel:${customer.phone}`)
    expect(screen.getByText(vehicle.vin)).toBeVisible()
    expect(screen.getByRole('spinbutton')).toHaveValue(12345)
    expect(screen.queryByText('AC')).not.toBeInTheDocument()
    expect(screen.queryByText(customer.email)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Service history' })).not.toBeInTheDocument()
  })
  it('reveals email and vehicle actions only in details, and never shows purchase data', () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'more' }))
    expect(screen.getByText(customer.email)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Service history' })).toHaveAttribute('href', '/vehicles/car')
    expect(screen.getByTestId('vehicle-detail-color')).toHaveTextContent('Black')
    expect(screen.queryByTestId('vehicle-detail-purchaseDate')).not.toBeInTheDocument()
    expect(screen.queryByTestId('vehicle-detail-purchasePrice')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Change vehicle' }))
    expect(screen.getByRole('button', { name: 'Vehicle picker' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'less' }))
    expect(screen.queryByText(customer.email)).not.toBeInTheDocument()
  })
  it('keeps details readable on a locked invoice but prevents changing vehicle and mileage', () => {
    show(true)
    expect(screen.getByRole('spinbutton')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'more' }))
    expect(screen.getByRole('button', { name: 'Change vehicle' })).toBeDisabled()
    expect(screen.getByText(customer.email)).toBeVisible()
  })
  it('allows choosing a vehicle when the order has none', () => {
    show(false, false)
    expect(screen.getByRole('button', { name: 'Vehicle picker' })).toBeVisible()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })
})
