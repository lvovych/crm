// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  legacyMoney,
  projectCustomers,
  type CustomerSource,
} from '@/features/mutual-settlements/projection'
const today = '2026-11-10'
const source = (extra: Partial<CustomerSource> = {}): CustomerSource => ({
  id: 'order',
  title: 'Order',
  invoiceNumber: 'WO-1',
  status: 'completed',
  totalAmount: 12000,
  cost: 12000,
  hasPricedLines: true,
  manuallyPaid: false,
  invoiceDueDate: new Date('2026-11-09T12:00:00Z'),
  invoiceDate: null,
  serviceDate: new Date('2026-11-08T12:00:00Z'),
  vehicleId: 'v',
  customer: { id: 'c', name: 'Customer', phone: '+380 67 111 22 33' },
  payments: [],
  ...extra,
})
const payment = (
  amount: number,
  amountExact: string | null = null,
  date = '2026-11-10T12:00:00Z'
) => ({ amount, amountExact, date: new Date(date) })
const project = (r: CustomerSource[]) => projectCustomers(r, today, 'Europe/Kyiv')
describe('read-only client settlement projection', () => {
  it.each([
    [0, '12000.00', '0.00'],
    [3000, '9000.00', '0.00'],
    [12000, '0.00', '0.00'],
    [13000, '0.00', '1000.00'],
  ])('handles paid amount %s', (paid, debt, advance) => {
    expect(project([source({ payments: [payment(paid)] })])[0]).toMatchObject({
      debt,
      advance,
      overdue: debt,
    })
  })
  it('does not net one document advance against another document debt', () => {
    const p = project([
      source(),
      source({ id: 'other', totalAmount: 0, payments: [payment(3000)] }),
    ])[0]
    expect(p).toMatchObject({ debt: '12000.00', advance: '3000.00' })
  })
  it('separates work in progress and its prepayment from debt', () => {
    expect(
      project([source({ status: 'in_progress', payments: [payment(3000)] })])[0]
    ).toMatchObject({ debt: '0.00', expected: '12000.00', advance: '3000.00', overdue: '0.00' })
  })
  it('does not resurrect cost when the priced document is fully discounted', () => {
    expect(project([source({ totalAmount: 0, cost: 1000 })])[0].debt).toBe('0.00')
  })
  it('supports legacy records without priced lines', () => {
    expect(project([source({ totalAmount: 0, hasPricedLines: false, cost: 1000 })])[0].debt).toBe(
      '1000.00'
    )
  })
  it('uses exact payments rather than their legacy float', () => {
    expect(
      project([
        source({ totalAmount: 1, payments: [payment(0.999, '0.20'), payment(0.1, '0.10')] }),
      ])[0].debt
    ).toBe('0.70')
  })
  it.each([
    [1.005, BigInt(101)],
    [2.675, BigInt(268)],
    [0.0049, BigInt(0)],
    [0.005, BigInt(1)],
    [0.015, BigInt(2)],
    [-0.005, BigInt(-1)],
    [0.1 + 0.2, BigInt(30)],
  ])('rounds legacy %s once', (value, result) => expect(legacyMoney(value)).toBe(result))
  it('sums many small payments without losing kopecks', () => {
    expect(
      project([
        source({ totalAmount: 100, payments: Array.from({ length: 999 }, () => payment(0.1)) }),
      ])[0].debt
    ).toBe('0.10')
  })
  it.each([
    NaN,
    Infinity,
    1e20,
  ])('flags unsafe amount %s instead of reporting zero as settled', (value) => {
    const p = project([source({ totalAmount: value })])[0]
    expect(p.debt).toBe('0.00')
    expect(p.documents[0].reason).toBeTruthy()
    expect(p.documents[0].amount).toBeNull()
  })
  it('never treats the manual-paid marker as evidence of payment', () => {
    const p = project([source({ manuallyPaid: true })])[0]
    expect(p.debt).toBe('0.00')
    expect(p.documents[0].reason).toContain('вручну')
    expect(p.documents[0].paid).toBe('0.00')
  })
  it('flags missing customers rather than losing documents', () => {
    const p = project([source({ customer: null })])[0]
    expect(p.id).toBe('unassigned')
    expect(p.documents[0].reason).toContain('клієнт')
    expect(p.debt).toBe('0.00')
  })
  it.each([
    { name: 'Renamed customer', phone: '+380 67 111 22 33' },
    { name: 'Customer', phone: '+380991234567' },
    { name: 'Renamed customer', phone: null },
    { name: 'Customer', phone: '+380671112233' },
  ])('keeps debt with the same customer ID after contact changes: %j', (contact) => {
    const record = {
      ...source({ customer: { id: 'c', ...contact }, payments: [payment(3000)] }),
      issuedData: { customer: { name: 'Customer', phone: '+380 67 111 22 33' } },
    }
    const p = project([record])[0]
    expect(p).toMatchObject({
      id: 'c',
      name: contact.name,
      phone: contact.phone || '',
      debt: '9000.00',
      overdue: '9000.00',
    })
    expect(p.documents[0].reason).toBeNull()
  })
  it('does not merge different IDs with identical names and phones', () => {
    const first = source()
    const second = source({ id: 'second', customer: { ...first.customer!, id: 'other' } })
    const parties = project([first, second])
    expect(parties).toHaveLength(2)
    expect(new Set(parties.map((p) => p.id))).toEqual(new Set(['c', 'other']))
    expect(parties.every((p) => p.debt === '12000.00')).toBe(true)
  })
  it('groups documents by customer ID even when display contact details differ', () => {
    const parties = project([
      source(),
      source({ id: 'second', customer: { id: 'c', name: 'New name', phone: 'new phone' } }),
    ])
    expect(parties).toHaveLength(1)
    expect(parties[0]).toMatchObject({ id: 'c', debt: '24000.00' })
    expect(parties[0].documents.every((d) => d.reason === null)).toBe(true)
  })
  it('does not count cancelled jobs but retains payments on them for review', () => {
    expect(project([source({ status: 'cancelled' })])).toEqual([])
    const p = project([source({ status: 'cancelled', payments: [payment(30)] })])[0]
    expect(p.debt).toBe('0.00')
    expect(p.advance).toBe('0.00')
    expect(p.documents[0].reason).toContain('скасованим')
  })
  it('flags negative and future payments', () => {
    expect(project([source({ payments: [payment(-10)] })])[0].documents[0].reason).toContain(
      'від’ємна'
    )
    expect(
      project([source({ payments: [payment(10, null, '2026-11-11T12:00:00Z')] })])[0].documents[0]
        .reason
    ).toContain('майбутньою')
  })
  it('does not mark due-today or unspecified terms overdue', () => {
    for (const date of [null, new Date('2026-11-10T12:00:00Z')])
      expect(project([source({ invoiceDueDate: date })])[0].overdue).toBe('0.00')
  })
  it('uses the workshop timezone at midnight', () => {
    expect(
      project([source({ payments: [payment(10, null, '2026-11-10T22:30:00Z')] })])[0].documents[0]
        .reason
    ).toContain('майбутньою')
  })
  it('links counter sales and does not mutate the source records', () => {
    const r = source({ vehicleId: null })
    const before = JSON.stringify(r)
    expect(project([r])[0].documents[0].href).toBe('/sales/order')
    expect(JSON.stringify(r)).toBe(before)
  })
})
