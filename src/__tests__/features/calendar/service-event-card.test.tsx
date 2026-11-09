import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { EventChip } from '@/features/calendar/Components/EventChip'
import type { CalendarEvent } from '@/features/calendar/Actions/calendarActions'
const openPeek = vi.fn()
vi.mock('@/features/calendar/Components/EventPeek', () => ({ useEventPeek: () => ({ openPeek }) }))
vi.mock('@/features/calendar/Components/EventContextMenu', () => ({ EventContextMenu: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/date-settings-context', () => ({ useDateSettings: () => ({ timeFormat: '24h' }) }))
const event: CalendarEvent = {
  id: 'job', title: '2026-1001', invoiceNumber: '2026-1001', type: 'service',
  date: '2026-11-09', time: '09:00', endTime: '10:00', status: 'pending',
  vehicleId: 'car', vehicleLabel: '2020 Toyota Camry', serviceVehiclePlate: 'AC1234AA', serviceVehicleLabel: 'Toyota Camry',
  customerName: 'Anna Client', amount: 100,
}
describe('calendar work order card', () => {
  it.each(['chip', 'timed', 'block', 'row'] as const)('shows only vehicle identification and customer in %s', (variant) => {
    render(<EventChip event={event} variant={variant} />)
    const card = screen.getByRole('button', { name: 'AC1234AA · Toyota Camry · Anna Client' })
    expect(card).toHaveTextContent('AC1234AA')
    expect(card).toHaveTextContent('Toyota Camry')
    if (variant === 'block' || variant === 'row') {
      expect(card.children).toHaveLength(3)
      expect(card.children[0]).toHaveTextContent('AC1234AA')
      expect(card.children[1]).toHaveTextContent('Toyota Camry')
    }
    expect(card).toHaveTextContent('Anna Client')
    expect(card).not.toHaveTextContent('2026-1001')
    expect(card).not.toHaveTextContent('09:00')
    expect(card).not.toHaveTextContent('100')
    fireEvent.click(card)
    expect(openPeek).toHaveBeenCalledWith(event, card)
  })
  it('handles missing vehicle and customer without leaking the invoice number', () => {
    render(<EventChip event={{ ...event, vehicleLabel: '', serviceVehicleLabel: '', customerName: null }} variant="block" />)
    expect(screen.getByRole('button')).not.toHaveTextContent('2026-1001')
  })
  it('keeps the original content for other calendar events', () => {
    render(<EventChip event={{ ...event, type: 'reminder', title: 'Call customer' }} variant="block" />)
    expect(screen.getByRole('button')).toHaveTextContent('Call customer')
    expect(screen.getByRole('button')).toHaveTextContent('09:00')
  })
})
