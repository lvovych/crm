import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const f = vi.hoisted(() => ({ send: vi.fn(), push: vi.fn(), refresh: vi.fn() }))
vi.mock('@/features/receipts/return-actions', () => ({ createSupplierReturn: f.send }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: f.push, refresh: f.refresh }) }))
import { ConsolidatedReturnForm } from '@/features/receipts/ConsolidatedReturnForm'
import { returnLineAmount } from '@/features/receipts/return-money'
const data = {
  supplierId: 'supplier',
  supplier: 'Supplier',
  lines: ['A', 'B'].map((id, i) => ({
    id,
    name: 'Part ' + id,
    brand: 'Lemforder',
    article: 'SKU-' + id,
    kind: 'part',
    receiptId: 'receipt' + id,
    receiptNumber: 'INV-' + id,
    receiptDate: '2026-11-18',
    unit: 'шт',
    unitPrice: String(100 + i * 100),
    available: '2.000',
    originalQuantity: '2',
    originalAmount: String(200 + i * 200) + '.00',
    returnedQuantity: '0',
    returnedAmount: '0.00',
  })),
}
afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  f.send.mockResolvedValue({ success: true, data: 'return-id' })
})
it('keeps selections across searches and submits one document for two invoices', async () => {
  render(<ConsolidatedReturnForm data={data} />)
  fireEvent.change(screen.getByLabelText('Знайти позицію'), { target: { value: 'SKU-A' } })
  fireEvent.click(screen.getByLabelText('Обрати Part A · INV-A'))
  fireEvent.change(screen.getByLabelText('Знайти позицію'), { target: { value: 'SKU-B' } })
  fireEvent.click(screen.getByLabelText('Обрати Part B · INV-B'))
  expect(screen.getByText('Сума: 300,00 грн')).toBeVisible()
  fireEvent.change(screen.getByLabelText('Причина повернення'), { target: { value: 'Відмова клієнта' } })
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти чернетку' }))
  await waitFor(() => expect(f.push).toHaveBeenCalledWith('/supplier-returns/return-id'))
  expect(f.send.mock.calls[0][0]).toMatchObject({
    supplierId: 'supplier',
    lines: [
      { id: 'A', quantity: '1' },
      { id: 'B', quantity: '1' },
    ],
  })
  expect(f.send.mock.calls[0][0]).not.toHaveProperty('receiptId')
})
it('shows brand and article and prevents an empty or excessive quantity submission', () => {
  render(<ConsolidatedReturnForm data={data} />)
  expect(screen.getAllByText('Lemforder')).toHaveLength(2)
  expect(screen.getByText('SKU-A')).toBeVisible()
  const submit = screen.getByRole('button', { name: 'Зберегти чернетку' })
  expect(submit).toBeDisabled()
  fireEvent.click(screen.getByLabelText('Обрати Part A · INV-A'))
  fireEvent.change(screen.getByLabelText('Кількість Part A · INV-A'), { target: { value: '3' } })
  expect(submit).toBeDisabled()
})
it('uses cumulative rounding for the last fractional return', () => {
  expect(
    returnLineAmount(
      {
        originalQuantity: '1',
        originalAmount: '0.01',
        returnedQuantity: '0.5',
        returnedAmount: '0.01',
        unitPrice: '0.01',
      },
      '0.5'
    )
  ).toBe('0.00')
})
