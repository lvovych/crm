import { beforeEach as beforeLocale, vi as localeMock } from 'vitest'
import { useLocale as testLocale } from 'next-intl'
// These scenarios exercise the Ukrainian operational interface.
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const f = vi.hoisted(() => ({ send: vi.fn(), search: vi.fn(), push: vi.fn(), refresh: vi.fn() }))
vi.mock('@/features/receipts/return-actions', () => ({
  createSupplierReturn: f.send,
  supplierReturnOptions: f.search,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: f.push, refresh: f.refresh }) }))
import { ConsolidatedReturnForm } from '@/features/receipts/ConsolidatedReturnForm'
import { returnLineAmount } from '@/features/receipts/return-money'
const data = {
  supplierId: 'supplier',
  supplier: 'Supplier',
  selectedLines: [],
  page: 1,
  q: '',
  hasMore: false,
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
  f.search.mockImplementation(async (_supplier, _ids, search) => ({
    success: true,
    data: {
      ...data,
      ...search,
      lines: data.lines.filter((line) => !search.q || line.article.includes(search.q)),
    },
  }))
})
it('keeps selections across searches and submits one document for two invoices', async () => {
  render(<ConsolidatedReturnForm data={data} />)
  fireEvent.change(screen.getByLabelText('Знайти позицію'), { target: { value: 'SKU-A' } })
  fireEvent.click(screen.getByRole('button', { name: 'Знайти' }))
  await waitFor(() =>
    expect(screen.queryByLabelText('Обрати Part B · INV-B')).not.toBeInTheDocument()
  )
  fireEvent.click(screen.getByLabelText('Обрати Part A · INV-A'))
  fireEvent.change(screen.getByLabelText('Знайти позицію'), { target: { value: 'SKU-B' } })
  fireEvent.click(screen.getByRole('button', { name: 'Знайти' }))
  await screen.findByLabelText('Обрати Part B · INV-B')
  fireEvent.click(screen.getByLabelText('Обрати Part B · INV-B'))
  expect(screen.getByText('Сума: 300,00 грн')).toBeVisible()
  fireEvent.change(screen.getByLabelText('Причина повернення'), {
    target: { value: 'Відмова клієнта' },
  })
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

it('preserves draft identity, version and supplier reference while editing', async () => {
  render(
    <ConsolidatedReturnForm
      data={data}
      initial={{
        id: 'draft-id',
        version: 4,
        reason: 'Інше',
        supplierDocumentNumber: 'ПВ-12',
        quantities: { A: '2' },
      }}
    />
  )
  expect(screen.getByLabelText('Номер документа постачальника')).toHaveValue('ПВ-12')
  fireEvent.change(screen.getByLabelText('Номер документа постачальника'), {
    target: { value: 'ПВ-13' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти чернетку' }))
  await waitFor(() => expect(f.send).toHaveBeenCalledTimes(1))
  expect(f.send.mock.calls[0][0]).toMatchObject({
    id: 'draft-id',
    version: 4,
    reason: 'Інше',
    supplierDocumentNumber: 'ПВ-13',
    lines: [{ id: 'A', quantity: '2' }],
  })
})

it('retries a lost response with the same identity and keeps the selection', async () => {
  f.send.mockRejectedValueOnce(new Error('Network interrupted'))
  render(<ConsolidatedReturnForm data={data} />)
  fireEvent.click(screen.getByLabelText('Обрати Part A · INV-A'))
  fireEvent.change(screen.getByLabelText('Причина повернення'), { target: { value: 'Інше' } })
  const submit = screen.getByRole('button', { name: 'Зберегти чернетку' })
  fireEvent.click(submit)
  await waitFor(() => expect(screen.getByRole('alert')).toBeVisible())
  const first = f.send.mock.calls[0][0]
  expect(screen.getByLabelText('Кількість Part A · INV-A')).toHaveValue(1)
  fireEvent.click(submit)
  await waitFor(() => expect(f.send).toHaveBeenCalledTimes(2))
  expect(f.send.mock.calls[1][0]).toEqual(first)
})

it('blocks a second submission while the first draft is being saved', async () => {
  let finish!: (value: { success: boolean; data: string }) => void
  f.send.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const { container } = render(<ConsolidatedReturnForm data={data} />)
  fireEvent.click(screen.getByLabelText('Обрати Part A · INV-A'))
  fireEvent.change(screen.getByLabelText('Причина повернення'), { target: { value: 'Інше' } })
  const form = container.querySelector('form')!
  fireEvent.submit(form)
  fireEvent.submit(form)
  expect(f.send).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Збереження…' })).toBeDisabled()
  finish({ success: true, data: 'return-id' })
  await waitFor(() => expect(f.push).toHaveBeenCalledWith('/supplier-returns/return-id'))
})

it('keeps positions from different server pages in a single draft', async () => {
  f.search.mockResolvedValueOnce({
    success: true,
    data: { ...data, lines: [data.lines[1]], page: 2, hasMore: false },
  })
  render(<ConsolidatedReturnForm data={{ ...data, lines: [data.lines[0]], hasMore: true }} />)
  fireEvent.click(screen.getByLabelText('Обрати Part A · INV-A'))
  fireEvent.click(screen.getByRole('button', { name: 'Далі' }))
  await screen.findByLabelText('Обрати Part B · INV-B')
  fireEvent.click(screen.getByLabelText('Обрати Part B · INV-B'))
  expect(screen.getByText('Сума: 300,00 грн')).toBeVisible()
  expect(f.search).toHaveBeenCalledWith('supplier', [], { page: 2, q: '' })
  fireEvent.change(screen.getByLabelText('Причина повернення'), { target: { value: 'Інше' } })
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти чернетку' }))
  await waitFor(() => expect(f.send).toHaveBeenCalledTimes(1))
  expect(f.send.mock.calls[0][0].lines).toEqual([
    { id: 'A', quantity: '1' },
    { id: 'B', quantity: '1' },
  ])
})

it('loads the selected draft rows separately even when they are not on the first page', async () => {
  render(
    <ConsolidatedReturnForm
      data={{ ...data, lines: [data.lines[0]], selectedLines: [data.lines[1]] }}
      initial={{ id: 'draft', version: 2, reason: 'Інше', quantities: { B: '2' } }}
    />
  )
  expect(screen.getByText('Сума: 400,00 грн')).toBeVisible()
  expect(screen.queryByLabelText('Обрати Part B · INV-B')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти чернетку' }))
  await waitFor(() => expect(f.send).toHaveBeenCalledTimes(1))
  expect(f.send.mock.calls[0][0].lines).toEqual([{ id: 'B', quantity: '2' }])
})

it('ignores an older search response arriving after a newer result', async () => {
  let old!: (value: unknown) => void
  f.search.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        old = resolve
      })
  )
  f.search.mockResolvedValueOnce({
    success: true,
    data: { ...data, q: 'B', lines: [data.lines[1]] },
  })
  render(<ConsolidatedReturnForm data={data} />)
  const input = screen.getByLabelText('Знайти позицію')
  fireEvent.change(input, { target: { value: 'A' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  fireEvent.change(input, { target: { value: 'B' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() =>
    expect(screen.queryByLabelText('Обрати Part A · INV-A')).not.toBeInTheDocument()
  )
  old({ success: true, data: { ...data, q: 'A', lines: [data.lines[0]] } })
  await waitFor(() => expect(screen.getByLabelText('Обрати Part B · INV-B')).toBeVisible())
  expect(screen.queryByLabelText('Обрати Part A · INV-A')).not.toBeInTheDocument()
})

beforeLocale(() => localeMock.mocked(testLocale).mockReturnValue('uk'))
