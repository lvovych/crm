import { describe, it, expect } from 'vitest'
import {
  projectLedger,
  type LedgerEvent,
  type LedgerDocument,
} from '@/features/customer-ledger/projection'
const customers = new Map([['c', { name: 'Андрій', phone: '123' }]])
function event(id: number, patch: Partial<LedgerEvent> = {}): LedgerEvent {
  return {
    id: String(id),
    kind: 'created',
    date: '2026-11-01',
    recordedAt: '2026-11-01T10:00:00Z',
    chargeDelta: '0.00',
    paidDelta: '0.00',
    amount: '100.00',
    status: 'pending',
    due: null,
    manualPaid: false,
    paymentId: null,
    sourceDate: null,
    actor: null,
    note: null,
    ...patch,
  }
}
function doc(events: LedgerEvent[], patch: Partial<LedgerDocument> = {}): LedgerDocument {
  return {
    id: 'r',
    customerId: 'c',
    customerName: 'Old name',
    vehicleId: 'v',
    label: 'Order',
    events,
    ...patch,
  }
}
const report = (events: LedgerEvent[], date = '2026-11-10') =>
  projectLedger([doc(events)], customers, date)[0]
describe('customer obligation history', () => {
  it('counts prepayment as advance until completion, then partial debt', () => {
    const events = [
      event(1),
      event(2, { status: null, paidDelta: '30.00' }),
      event(3, { date: '2026-11-05', status: 'completed', chargeDelta: '100.00' }),
    ]
    expect(report(events, '2026-11-04')).toMatchObject({
      debt: '0.00',
      advance: '30.00',
      expected: '100.00',
    })
    expect(report(events)).toMatchObject({ debt: '70.00', advance: '0.00', expected: '0.00' })
  })
  it('keeps overpayment separate from debt on another order', () => {
    const p = projectLedger(
      [
        doc([
          event(1, { status: 'completed', chargeDelta: '100.00' }),
          event(2, { status: null, paidDelta: '120.00' }),
        ]),
        doc([event(3, { status: 'completed', chargeDelta: '100.00' })], { id: 'r2' }),
      ],
      customers,
      '2026-11-10'
    )[0]
    expect(p).toMatchObject({ debt: '100.00', advance: '20.00' })
  })
  it('cancellation reverses the obligation while preserving refundable advance', () => {
    expect(
      report([
        event(1, { status: 'completed', chargeDelta: '100.00' }),
        event(2, { status: null, paidDelta: '30.00' }),
        event(3, { status: 'cancelled', chargeDelta: '-100.00' }),
      ])
    ).toMatchObject({ debt: '0.00', advance: '30.00', expected: '0.00' })
  })
  it('refunds and reversals preserve all entries and exact cents', () => {
    const p = report([
      event(1, { status: 'completed', chargeDelta: '0.30', amount: '0.30' }),
      event(2, { status: null, paidDelta: '0.10' }),
      event(3, { status: null, paidDelta: '0.20' }),
      event(4, { status: null, paidDelta: '-0.10' }),
    ])
    expect(p.debt).toBe('0.10')
    expect(p.documents[0].history).toHaveLength(4)
  })
  it('does not invent history before creation or include future payments', () => {
    expect(projectLedger([doc([event(1)])], customers, '2026-10-31')).toEqual([])
    expect(
      report([event(1), event(2, { date: '2026-12-01', status: null, paidDelta: '100.00' })])
        .advance
    ).toBe('0.00')
  })
  it('uses ID after customer name and phone change', () => {
    expect(report([event(1)])).toMatchObject({ id: 'c', name: 'Андрій', phone: '123' })
    expect(report([event(1)]).documents[0].reason).toBeNull()
  })
  it.each([true, false])('due date is overdue only before report date (%s)', (before) => {
    expect(
      report([
        event(1, {
          status: 'completed',
          chargeDelta: '100.00',
          due: before ? '2026-11-09' : '2026-11-10',
        }),
      ]).overdue
    ).toBe(before ? '100.00' : '0.00')
  })
  it('does not let a manual-paid flag erase a recorded obligation', () => {
    const p = report([event(1, { status: 'completed', chargeDelta: '100.00', manualPaid: true })])
    expect(p.debt).toBe('100.00')
    expect(p.documents[0].reason).toBeNull()
    expect(p.documents[0].amount).toBe('100.00')
  })
  it('excludes unassigned customers and deleted empty drafts', () => {
    expect(
      projectLedger(
        [doc([event(1, { status: 'completed', chargeDelta: '100.00' })], { customerId: null })],
        customers,
        '2026-11-10'
      )[0].debt
    ).toBe('0.00')
    expect(
      projectLedger([doc([event(1), event(2, { status: 'deleted' })])], customers, '2026-11-10')
    ).toEqual([])
  })
  it('orders same-day events by numeric IDs rather than lexical order', () => {
    expect(
      report([event(10, { status: 'completed', chargeDelta: '100.00' }), event(9)]).expected
    ).toBe('0.00')
  })
})
