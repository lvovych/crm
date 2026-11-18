import { beforeEach, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LedgerHistory } from '@/features/mutual-settlements/LedgerHistory'
import type { DocumentRow } from '@/features/mutual-settlements/types'
const load = vi.hoisted(() => vi.fn())
vi.mock('@/features/customer-ledger/history', () => ({ documentHistory: load }))
const row = { id: 'doc', historyAsOf: '2026-01-01', historyCount: 2 } as DocumentRow
const event = (id: string) => ({
  id,
  kind: 'payment',
  date: '2026-01-01',
  recordedAt: '2026-01-01T00:00:00Z',
  chargeDelta: '0.00',
  paidDelta: '1.00',
  amount: null,
  status: null,
  due: null,
  manualPaid: null,
  paymentId: null,
  sourceDate: null,
  actor: null,
  note: null,
})
beforeEach(() => load.mockReset())
it('loads only on expansion, retries failures and pages without losing earlier entries', async () => {
  load
    .mockResolvedValueOnce({ success: false })
    .mockResolvedValueOnce({ success: true, data: { events: [event('2')], next: '2' } })
    .mockResolvedValueOnce({ success: true, data: { events: [event('1')], next: null } })
  const { container } = render(<LedgerHistory row={row} />)
  expect(load).not.toHaveBeenCalled()
  const details = container.querySelector('details')!
  details.open = true
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: 'Повторити' }))
  await screen.findByRole('button', { name: 'Попередні записи' })
  fireEvent.click(screen.getByRole('button', { name: 'Попередні записи' }))
  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2))
  expect(load).toHaveBeenLastCalledWith('doc', '2026-01-01', '2')
  expect(screen.queryByRole('button', { name: 'Попередні записи' })).toBeNull()
})
it('renders already supplied history without a request', () => {
  const { container } = render(<LedgerHistory row={{ ...row, history: [event('1')] }} />)
  const details = container.querySelector('details')!
  details.open = true
  expect(load).not.toHaveBeenCalled()
})
