import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {
        /* No layout in jsdom. */
      }
      unobserve() {
        /* No layout in jsdom. */
      }
      disconnect() {
        /* No layout in jsdom. */
      }
    }
  )
  Element.prototype.scrollIntoView = vi.fn()
  save.mockReset()
  save.mockResolvedValue({ data: { id: 'saved' } })
  push.mockReset()
})
afterEach(() => vi.unstubAllGlobals())
describe('receipt article and brand entry', () => {
  it('fills the card fields and cost by one article, preserving receipt quantity', () => {
    render(<ReceiptForm options={options} initial={initial} canPost />)
    fireEvent.change(screen.getByLabelText('Артикул'), { target: { value: ' vd 1105 ' } })
    expect(screen.getByLabelText('Назва')).toHaveValue('Фільтр')
    expect(screen.getByLabelText('Бренд')).toHaveTextContent('Febi')
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
    fireEvent.click(screen.getByRole('combobox', { name: 'Бренд' }))
    fireEvent.click(screen.getByRole('option', { name: 'Bosch' }))
    expect(screen.getByLabelText('Назва')).toHaveValue('Інший фільтр')
    expect(screen.getByLabelText('Ціна, грн')).toHaveValue(99)
  })
  it('submits a new product in the receipt instead of creating it separately', async () => {
    render(<ReceiptForm options={options} initial={initial} canPost />)
    fireEvent.change(screen.getByLabelText('Артикул'), { target: { value: 'NEW' } })
    fireEvent.click(screen.getByRole('combobox', { name: 'Бренд' }))
    fireEvent.click(screen.getByRole('option', { name: 'Febi' }))
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
    fireEvent.click(screen.getByRole('combobox', { name: 'Постачальник' }))
    fireEvent.click(screen.getByRole('option', { name: 'Other' }))
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
    expect(screen.getByLabelText('Бренд')).toHaveTextContent('Febi')
    expect(screen.getByLabelText('Ціна, грн')).toHaveValue(77.77)
    expect(screen.getByLabelText('Назва')).toHaveValue('Історична назва')
  })
})

describe('receipt entry workflow', () => {
  it('focuses a new article and removes only the selected line', () => {
    render(<ReceiptForm options={options} initial={initial} canPost />)
    fireEvent.change(screen.getByLabelText('Артикул'), { target: { value: 'VD1105' } })
    fireEvent.click(screen.getByRole('button', { name: 'Додати позицію' }))
    expect(screen.getAllByLabelText('Артикул')[1]).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Видалити позицію 2' }))
    expect(screen.getByLabelText('Артикул')).toHaveValue('VD1105')
    expect(screen.getByLabelText('Ціна, грн')).toHaveValue(123.45)
  })
  it('requires a brand before saving and never posts without permission', () => {
    render(
      <ReceiptForm
        options={options}
        initial={{ ...initial, lines: [{ ...line, article: 'NEW', name: 'New' }] }}
        canPost={false}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти чернетку' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Оберіть бренд')
    expect(save).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Зберегти й провести' })).not.toBeInTheDocument()
  })
  it('searches brands and submits posting explicitly', async () => {
    render(<ReceiptForm options={options} initial={initial} canPost />)
    fireEvent.change(screen.getByLabelText('Артикул'), { target: { value: 'NEW' } })
    fireEvent.change(screen.getByLabelText('Назва'), { target: { value: 'New' } })
    fireEvent.click(screen.getByRole('combobox', { name: 'Бренд' }))
    fireEvent.change(screen.getByLabelText('Пошук: Бренд'), { target: { value: 'Bosch' } })
    expect(screen.queryByRole('option', { name: 'Febi' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: 'Bosch' }))
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти й провести' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0][1]).toBe(true)
    expect(save.mock.calls[0][0].lines[0].brandId).toBe('bosch')
  })
})

describe('receipt failures and service entry', () => {
  it('retains entered fields after server failure and allows retry', async () => {
    save.mockResolvedValueOnce({ error: 'Документ змінився' })
    render(<ReceiptForm options={options} initial={initial} canPost />)
    fireEvent.change(screen.getByLabelText('Артикул'), { target: { value: 'VD1105' } })
    fireEvent.change(screen.getByLabelText('Ціна, грн'), { target: { value: '88.1234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти чернетку' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Документ змінився'))
    expect(screen.getByLabelText('Ціна, грн')).toHaveValue(88.1234)
    expect(push).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти чернетку' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/receipts/saved'))
  })
  it('offers the existing duplicate without navigating away or discarding data', async () => {
    save.mockResolvedValue({ data: { id: 'existing', duplicate: true } })
    render(<ReceiptForm options={options} initial={initial} canPost />)
    fireEvent.change(screen.getByLabelText('Артикул'), { target: { value: 'VD1105' } })
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти чернетку' }))
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Така накладна вже є/ })).toHaveAttribute(
        'href',
        '/receipts/existing'
      )
    )
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Артикул')).toHaveValue('VD1105')
  })
  it('switches a linked part to a service without retaining inventory identity', async () => {
    render(<ReceiptForm options={options} initial={initial} canPost />)
    fireEvent.change(screen.getByLabelText('Артикул'), { target: { value: 'VD1105' } })
    fireEvent.change(screen.getByLabelText('Тип'), { target: { value: 'service' } })
    expect(screen.getByLabelText('Артикул')).toBeDisabled()
    expect(screen.queryByRole('combobox', { name: 'Бренд' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Назва'), { target: { value: 'Доставка' } })
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти чернетку' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0][0].lines[0]).toMatchObject({
      kind: 'service',
      partId: null,
      article: '',
      brandId: undefined,
      unit: 'посл.',
    })
  })
})
