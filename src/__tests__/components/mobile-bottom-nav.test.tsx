import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ServiceTypeProvider } from '@/components/service-type-context'

vi.mock('next/navigation', () => ({
  usePathname: () => '/work-orders',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/components/barcode-scanner-dialog', () => ({ BarcodeScannerDialog: () => null }))
vi.mock('@/features/inventory/Components/InventoryPartForm', () => ({
  InventoryPartForm: () => null,
}))
vi.mock('@/features/inventory/Actions/lookupPartByBarcode', () => ({
  lookupPartByBarcode: vi.fn(),
}))
vi.mock('@/features/inventory/Actions/inventoryActions', () => ({
  adjustInventoryStock: vi.fn(),
  getInventoryPart: vi.fn(),
}))

const { MobileBottomNav } = await import('@/components/mobile-bottom-nav')

function renderNav(serviceType?: string) {
  return render(
    <ServiceTypeProvider serviceType={serviceType}>
      <MobileBottomNav />
    </ServiceTypeProvider>
  )
}

describe('MobileBottomNav', () => {
  it('shows Vehicles with a car to an automotive workshop', () => {
    renderNav('automotive')
    expect(screen.getByRole('link', { name: 'Calendar' })).toHaveAttribute('href', '/calendar')
    expect(screen.queryByRole('link', { name: 'Vehicles' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    const link = screen.getByRole('link', { name: 'Vehicles' })
    expect(link).toHaveAttribute('href', '/vehicles')
    expect(link.querySelector('.lucide-car')).not.toBeNull()
    expect(screen.queryByRole('link', { name: 'Vessels' })).toBeNull()
  })

  it('treats a workshop with no service type stored as automotive', () => {
    renderNav(undefined)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('link', { name: 'Vehicles' })).toBeInTheDocument()
  })

  it('shows Vessels with a ship to a marine workshop, on the same list', () => {
    renderNav('marine')
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    const link = screen.getByRole('link', { name: 'Vessels' })
    expect(link).toHaveAttribute('href', '/vehicles')
    expect(link.querySelector('.lucide-ship')).not.toBeNull()
    expect(screen.queryByRole('link', { name: 'Vehicles' })).toBeNull()
  })
})
