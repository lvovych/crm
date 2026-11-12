import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BoardJobIdentity } from '@/features/workboard/Components/BoardJobIdentity'
describe('compact board work order card', () => {
  it('shows plate, make/model and customer as separate rows', () => {
    render(
      <BoardJobIdentity
        job={{
          vehicle: {
            licensePlate: 'AC1234AA',
            make: 'Toyota',
            model: 'Camry',
            customer: { name: 'Anna', phone: '+380671234567' },
          },
        }}
      />
    )
    const card = screen.getByTestId('board-job-identity')
    expect(card.title).toContain('+380671234567')
    expect(Array.from(card.children).map((node) => node.textContent)).toEqual([
      'AC1234AA',
      'Toyota Camry',
      'Anna',
    ])
  })
  it('prefers the resolved customer, and supports an order without a vehicle', () => {
    render(<BoardJobIdentity job={{ vehicle: null, customerName: 'Direct customer' }} />)
    expect(screen.getByTestId('board-job-identity')).toHaveTextContent('Direct customer')
  })
  it('keeps the phone empty when the order customer has no number', () => {
    render(<BoardJobIdentity job={{
      customerName: 'Direct customer', customerPhone: null,
      vehicle: { licensePlate: null, make: 'Ford', model: 'Focus', customer: { name: 'Owner', phone: '12345' } },
    }} />)
    expect(screen.getByTestId('board-job-identity').title).toBe('Ford Focus · Direct customer')
  })
  it('omits missing fields without showing null or undefined', () => {
    render(
      <BoardJobIdentity job={{ vehicle: { licensePlate: null, make: 'Ford', model: 'Focus' } }} />
    )
    expect(screen.getByTestId('board-job-identity').textContent).toBe('Ford Focus')
  })
})
