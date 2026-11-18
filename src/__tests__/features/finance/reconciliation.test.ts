// @vitest-environment node
import { it, expect } from 'vitest'
import {
  reconcileInvoice,
  reconcilePosting,
  reconcileReturn,
} from '@/features/finance/reconciliation'
it('reports printed discrepancies without recomputing historical rounding', () => {
  const row = {
    id: 'i',
    subtotal: 0.94,
    discountAmount: 0,
    taxAmount: 0.24,
    taxInclusive: false,
    totalAmount: 1.17,
    lineTotals: [0.94],
  }
  expect(reconcileInvoice(row)).toEqual([
    { entity: 'ServiceRecord', id: 'i', check: 'printed-total', expected: '1.18', actual: '1.17' },
  ])
  expect(reconcileInvoice({ ...row, totalAmount: 1.18 })).toEqual([])
})
it('checks both transfer legs and linked payment amounts', () => {
  const r = {
    id: 'd',
    amount: '10.01',
    sourceAccountId: 'a',
    targetAccountId: 'b',
    entries: [
      { accountId: 'a', amount: '-10.01' },
      { accountId: 'b', amount: '10.01' },
    ],
  }
  expect(reconcilePosting(r)).toEqual([])
  expect(reconcilePosting({ ...r, entries: r.entries.slice(0, 1) })).toHaveLength(1)
  expect(reconcilePosting({ ...r, paymentAmount: '9.99' }).at(-1)?.check).toBe('linked-payment')
})
it('checks full returns and availability including outstanding transfers', () => {
  const r = {
    id: 'l',
    quantity: '1',
    amount: '0.33',
    returnedQuantity: '1',
    returnedAmount: '0.33',
    consumedQuantity: '0',
  }
  expect(reconcileReturn(r)).toEqual([])
  expect(reconcileReturn({ ...r, returnedAmount: '0.32' })).toHaveLength(1)
  expect(reconcileReturn({ ...r, consumedQuantity: '0.001' })).toHaveLength(1)
})
