import { render, screen, within, cleanup, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { OverviewClient } from '@/features/mutual-settlements/OverviewClient'
import type { Overview, PartyRow } from '@/features/mutual-settlements/types'
afterEach(cleanup)
const party = (id: string, overrides: Partial<PartyRow> = {}): PartyRow => ({
  id,
  name: `Клієнт ${id}`,
  phone: '+380 (67) 123-45-67',
  kind: 'customer',
  archived: false,
  debt: '100.00',
  advance: '0.00',
  overdue: '100.00',
  expected: '0.00',
  documents: [
    {
      id: `doc-${id}`,
      label: `Наряд ${id}`,
      href: `/sales/${id}`,
      date: '2026-11-09',
      due: '2026-11-09',
      amount: '150.00',
      paid: '50.00',
      debt: '100.00',
      advance: '0.00',
      expected: '0.00',
      reason: null,
      provisional: true,
    },
  ],
  ...overrides,
})
const data = (overrides: Partial<Overview> = {}): Overview => ({
  today: '2026-11-10',
  asOf: '2026-11-10',
  customersAllowed: true,
  suppliersAllowed: true,
  customersHistoricalUnavailable: false,
  supplierError: null,
  parties: [party('А'), party('Б', { kind: 'supplier', name: 'Постачальник Б' })],
  ...overrides,
})
describe('settlement overview interactions', () => {
  it('separates customers and suppliers with clear preliminary totals', () => {
    render(<OverviewClient data={data()} />)
    expect(screen.getByText('Клієнтські суми попередні.')).toBeVisible()
    expect(screen.queryByRole('article', { name: 'Постачальник Б' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Постачальники' }))
    expect(screen.getByRole('article', { name: 'Постачальник Б' })).toBeVisible()
    expect(screen.queryByRole('article', { name: 'Клієнт А' })).not.toBeInTheDocument()
  })
  it('searches formatted phone and document then resets', () => {
    render(<OverviewClient data={data()} />)
    fireEvent.change(screen.getByPlaceholderText('Ім’я, назва, телефон або документ'), {
      target: { value: '0671234567' },
    })
    expect(screen.getByRole('article', { name: 'Клієнт А' })).toBeVisible()
    fireEvent.change(screen.getByPlaceholderText('Ім’я, назва, телефон або документ'), {
      target: { value: 'невідомий' },
    })
    expect(screen.getByText('За цими умовами документів не знайдено.')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Скинути фільтри' }))
    expect(screen.getByRole('article', { name: 'Клієнт А' })).toBeVisible()
  })
  it('opens document details and preserves direct link, without payment controls', () => {
    render(<OverviewClient data={data()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Документи: Клієнт А' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('link', { name: /Відкрити документ/ })).toHaveAttribute(
      'href',
      '/sales/А'
    )
    expect(within(dialog).getByText('Оплати за записами')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: /Провести оплату|Зберегти/ })
    ).not.toBeInTheDocument()
  })
  it('filters advances separately from debt', () => {
    render(
      <OverviewClient
        data={data({
          parties: [party('А'), party('Б', { advance: '25.00', debt: '0.00', overdue: '0.00' })],
        })}
      />
    )
    fireEvent.change(screen.getByRole('combobox', { name: 'Показати контрагентів' }), {
      target: { value: 'advance' },
    })
    expect(screen.queryByRole('article', { name: 'Клієнт А' })).not.toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Клієнт Б' })).toBeVisible()
  })
  it('shows review reason and excludes ordinary documents in review details', () => {
    const p = party('А')
    p.documents.push({
      ...p.documents[0],
      id: 'unknown',
      label: 'Незвірений',
      reason: 'Потрібна ручна звірка',
    })
    render(<OverviewClient data={data({ parties: [p] })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Не враховано в підсумках (1)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Документи: Клієнт А' }))
    expect(
      within(screen.getByRole('dialog')).queryByRole('article', { name: 'Наряд А' })
    ).not.toBeInTheDocument()
    expect(
      within(screen.getByRole('dialog')).getByRole('article', { name: 'Незвірений' })
    ).toBeVisible()
  })
  it('does not show fabricated historical customer totals', () => {
    render(
      <OverviewClient
        data={data({ asOf: '2026-11-01', customersHistoricalUnavailable: true, parties: [] })}
      />
    )
    expect(screen.getByText('Історичний клієнтський борг поки недоступний')).toBeVisible()
    expect(screen.queryByRole('region', { name: 'Підсумки вибірки' })).not.toBeInTheDocument()
  })
  it('shows supplier failure instead of zero balance', () => {
    render(
      <OverviewClient
        initialView="supplier"
        data={data({ supplierError: 'Помилка завантаження' })}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent('підсумок неповний')
    expect(screen.queryByText('Ми винні постачальникам')).not.toBeInTheDocument()
  })
  it('hides forbidden tabs and rejects forbidden initial view', () => {
    render(
      <OverviewClient
        initialView="customer"
        data={data({ customersAllowed: false, parties: [party('Б', { kind: 'supplier' })] })}
      />
    )
    expect(screen.queryByRole('button', { name: 'Клієнти' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Постачальники' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })
  it('paginates and returns to page one on search', () => {
    render(
      <OverviewClient
        data={data({
          parties: Array.from({ length: 26 }, (_, i) => party(String(i).padStart(2, '0'))),
        })}
      />
    )
    expect(screen.getAllByRole('article')).toHaveLength(25)
    fireEvent.click(screen.getByRole('button', { name: 'Далі' }))
    expect(screen.getAllByRole('article')).toHaveLength(1)
    fireEvent.change(screen.getByPlaceholderText('Ім’я, назва, телефон або документ'), {
      target: { value: 'Наряд 00' },
    })
    expect(screen.getByRole('article', { name: 'Клієнт 00' })).toBeVisible()
  })
})
it('shows both the advance and expected amount for a job in progress', () => {
  const p = party('А', { debt: '0.00', advance: '40.00', expected: '100.00' })
  p.documents = [{ ...p.documents[0], debt: '0.00', advance: '40.00', expected: '100.00' }]
  render(<OverviewClient data={data({ parties: [p] })} />)
  fireEvent.click(screen.getByRole('button', { name: 'Документи: Клієнт А' }))
  const dialog = within(screen.getByRole('dialog'))
  expect(dialog.getByText('Аванс / переплата')).toBeVisible()
  expect(dialog.getByText('40,00 грн')).toBeVisible()
  expect(dialog.getByText('Очікувана сума в роботі')).toBeVisible()
  expect(dialog.getByText('100,00 грн')).toBeVisible()
})

it('uses the exclusion label consistently in the tab, filter and party notice', () => {
  const p = party('А')
  p.documents[0].reason = 'Позначено оплаченим вручну'
  render(<OverviewClient data={data({ parties: [p] })} />)
  expect(screen.getByRole('button', { name: 'Не враховано в підсумках (1)' })).toBeVisible()
  expect(screen.getByRole('option', { name: 'Не враховано в підсумках' })).toBeInTheDocument()
  expect(screen.getByRole('article', { name: 'Клієнт А' })).toHaveTextContent(
    'Не враховано в підсумках: 1 документів'
  )
  expect(screen.queryByText(/Потребу[єють]+ звірки/)).not.toBeInTheDocument()
})
