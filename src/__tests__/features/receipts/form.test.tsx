import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReceiptForm from '@/features/receipts/ReceiptForm'
const { save, push } = vi.hoisted(() => ({ save: vi.fn(), push: vi.fn() }))
vi.mock('@/features/receipts/actions', () => ({ saveDraft: save }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))
const part = {
  id: 'p',
  name: 'Фільтр',
  brandId: 'febi',
  brand: { name: 'Febi' },
  partNumber: 'VD1105',
  barcode: null,
  unit: 'шт',
  unitCost: 123.45,
  supplierArticles: [],
}
const options = {
  suppliers: [{ id: 's', name: 'Supplier' }],
  parts: [part],
  brands: [
    { id: 'febi', name: 'Febi', isActive: true },
    { id: 'bosch', name: 'Bosch', isActive: true },
  ],
}
const line = {
  kind: 'part' as const,
  article: '',
  name: '',
  partId: null,
  quantity: '2',
  unitPrice: '0',
  unit: 'шт',
}
const initial = {
  id: 'r',
  version: 0,
  number: '1',
  supplierId: 's',
  documentDate: '2026-11-09',
  receivedDate: '2026-11-09',
  lines: [line],
}
beforeEach(() => {
  save.mockReset()
  save.mockResolvedValue({ data: { id: 'saved' } })
  push.mockReset()
})
describe('receipt article and brand entry', () => {
  it('fills the card fields and cost by one article, preserving receipt quantity', () => {
    render(<ReceiptForm options={options} initial={initial} canPost />)
    fireEvent.change(screen.getByLabelText('Артикул'), { target: { value: ' vd 1105 ' } })
    expect(screen.getByLabelText('Назва')).toHaveValue('Фільтр')
    expect(screen.getByLabelText('Бренд')).toHaveValue('febi')
    expect(screen.getByLabelText('Ціна, грн')).toHaveValue(123.45)
    expect(screen.getByLabelText('Кількість')).toHaveValue(2)
    expect(screen.queryByText('Оберіть товар для цього артикула')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Створити складську/ })).not.toBeInTheDocument()
  })
  it('resolves a shared article only after choosing the brand', () => {
    render(
      <ReceiptForm
        options={{
          ...options,
          parts: [
            part,
            {
              ...part,
              id: 'p2',
              brandId: 'bosch',
              brand: { name: 'Bosch' },
              name: 'Інший фільтр',
              unitCost: 99,
            },
          ],
        }}
        initial={initial}
        canPost
      />
    )
    fireEvent.change(screen.getByLabelText('Артикул'), { target: { value: 'VD1105' } })
    expect(screen.getByLabelText('Назва')).toHaveValue('')
    fireEvent.change(screen.getByLabelText('Бренд'), { target: { value: 'bosch' } })
    expect(screen.getByLabelText('Назва')).toHaveValue('Інший фільтр')
    expect(screen.getByLabelText('Ціна, грн')).toHaveValue(99)
  })
  it('submits a new product in the receipt instead of creating it separately', async () => {
    render(<ReceiptForm options={options} initial={initial} canPost />)
    fireEvent.change(screen.getByLabelText('Артикул'), { target: { value: 'NEW' } })
    fireEvent.change(screen.getByLabelText('Бренд'), { target: { value: 'febi' } })
    fireEvent.change(screen.getByLabelText('Назва'), { target: { value: 'Новий фільтр' } })
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти чернетку' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0][0].lines[0]).toMatchObject({
      article: 'NEW',
      brandId: 'febi',
      partId: null,
      name: 'Новий фільтр',
    })
  })
  it('keeps the negotiated receipt price when the supplier changes', () => {
    render(
      <ReceiptForm
        options={{ ...options, suppliers: [...options.suppliers, { id: 's2', name: 'Other' }] }}
        initial={initial}
        canPost
      />
    )
    fireEvent.change(screen.getByLabelText('Артикул'), { target: { value: 'VD1105' } })
    fireEvent.change(screen.getByLabelText('Ціна, грн'), { target: { value: '99.99' } })
    fireEvent.change(screen.getByLabelText('Постачальник'), { target: { value: 's2' } })
    expect(screen.getByLabelText('Ціна, грн')).toHaveValue(99.99)
  })
  it('loads the brand from the linked card without changing saved invoice values', () => {
    render(
      <ReceiptForm
        options={options}
        initial={{
          ...initial,
          lines: [
            {
              ...line,
              partId: 'p',
              article: 'VD1105',
              name: 'Історична назва',
              unitPrice: '77.77',
            },
          ],
        }}
        canPost
      />
    )
    expect(screen.getByLabelText('Бренд')).toHaveValue('febi')
    expect(screen.getByLabelText('Ціна, грн')).toHaveValue(77.77)
    expect(screen.getByLabelText('Назва')).toHaveValue('Історична назва')
  })
})
