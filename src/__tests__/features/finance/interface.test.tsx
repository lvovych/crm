import { act, render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
const api = vi.hoisted(() => ({
  financeReport: vi.fn(),
  financeChoices: vi.fn(),
  postFinanceDocument: vi.fn(),
  saveFinanceDraft: vi.fn(),
  updateFinanceDraft: vi.fn(),
  postSavedFinanceDraft: vi.fn(),
  discardFinanceDraft: vi.fn(),
  saveFinanceDirectory: vi.fn(),
  prepareCashOpening: vi.fn(),
  activateCashOpening: vi.fn(),
  reverseMoneyDocument: vi.fn(),
  assignUnlinkedPayment: vi.fn(),
  refundMoneyDocument: vi.fn(),
}))
vi.mock('@/features/finance/actions', () => api)
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))
import { FinanceClient } from '@/features/finance/FinanceClient'
import { AccountSelect } from '@/features/finance/AccountSelect'
const fixture = () => ({
  asOf: '2026-11-10',
  unlinkedCount: 0,
  active: true,
  start: '2026-11-01',
  isAdmin: true,
  capabilities: { manage: true, post: true, draft: true, reverse: true, transfer: true },
  accountAccess: [],
  roles: [{ id: 'role', name: 'Менеджер' }],
  postAccountIds: ['cash'],
  accounts: [
    { id: 'cash', name: 'Офіс', kind: 'cash', entity: 'ФОП', archived: false, balance: '100.01' },
  ],
  entries: [],
  categories: [{ id: 'rent', name: 'Оренда', direction: 'expense', archived: false }],
  entities: [{ id: 'entity', name: 'ФОП' }],
  pending: [],
  batches: [],
  unlinked: [],
  drafts: [],
})
beforeEach(() => {
  vi.resetAllMocks()
  api.financeReport.mockResolvedValue({ success: true, data: fixture() })
  api.postFinanceDocument.mockResolvedValue({ success: true, data: { id: 'doc' } })
})
afterEach(cleanup)
describe('cash interface', () => {
  it('ignores stale responses when the as-of date is changed quickly', async () => {
    let older!: (value: unknown) => void, newer!: (value: unknown) => void
    api.financeReport
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            older = resolve
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            newer = resolve
          })
      )
    render(<FinanceClient initial={fixture()} today="2026-11-10" />)
    fireEvent.change(screen.getByLabelText('Залишки на кінець дати'), {
      target: { value: '2026-11-11' },
    })
    fireEvent.change(screen.getByLabelText('Залишки на кінець дати'), {
      target: { value: '2026-11-12' },
    })
    await act(async () => newer({ success: true, data: { ...fixture(), asOf: '2026-11-12' } }))
    await act(async () => older({ success: true, data: { ...fixture(), asOf: '2026-11-11' } }))
    expect(screen.getByText('Рухи до 12.11.2026 включно')).toBeVisible()
    expect(screen.queryByText('Рухи до 11.11.2026 включно')).not.toBeInTheDocument()
  })

  it('keeps the inactive workflow explicit and disables posting', () => {
    render(
      <FinanceClient initial={{ ...fixture(), active: false, start: null }} today="2026-11-10" />
    )
    expect(screen.getByText('Підготовка касового обліку')).toBeVisible()
    expect(screen.getByRole('button', { name: /Додати операцію/ })).toBeDisabled()
    expect(screen.getAllByText('Облік ще не активовано').length).toBeGreaterThan(0)
  })
  it('does not offer posting or settings to a read-only role', () => {
    const data = fixture()
    data.isAdmin = false
    data.capabilities = {
      manage: false,
      post: false,
      draft: false,
      reverse: false,
      transfer: false,
    }
    render(<FinanceClient initial={data} today="2026-11-10" />)
    expect(screen.getByRole('button', { name: /Додати операцію/ })).toBeDisabled()
    expect(screen.queryByText('Налаштування та початкові залишки')).not.toBeInTheDocument()
  })
  it('sends decimal input unchanged and preserves fields on rejection', async () => {
    api.postFinanceDocument.mockResolvedValue({ success: false, error: 'Недостатньо коштів' })
    render(<FinanceClient initial={fixture()} today="2026-11-10" />)
    fireEvent.click(screen.getByRole('button', { name: /Додати операцію/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Інша витрата' }))
    fireEvent.change(screen.getByLabelText('Сума, грн'), { target: { value: '10,01' } })
    fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Стаття'), {
      target: { value: 'rent' },
    })
    fireEvent.change(screen.getByLabelText('Призначення'), { target: { value: 'Оренда' } })
    fireEvent.click(screen.getByRole('button', { name: 'Провести витрату' }))
    await waitFor(() =>
      expect(api.postFinanceDocument).toHaveBeenCalledWith(
        expect.objectContaining({ amount: '10,01', sourceAccountId: 'cash', categoryId: 'rent' })
      )
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('Недостатньо коштів')
    expect(screen.getByLabelText('Сума, грн')).toHaveValue('10,01')
  })
  it('cancel never sends a financial operation', () => {
    render(<FinanceClient initial={fixture()} today="2026-11-10" />)
    fireEvent.click(screen.getByRole('button', { name: /Додати операцію/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Інше надходження коштів' }))
    fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }))
    expect(api.postFinanceDocument).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
describe('account selection in existing payment forms', () => {
  it('adds no field before activation', async () => {
    api.financeChoices.mockResolvedValue({ success: true, data: { active: false, accounts: [] } })
    render(<AccountSelect />)
    await waitFor(() => expect(api.financeChoices).toHaveBeenCalled())
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })
  it('defaults the only permitted account', async () => {
    api.financeChoices.mockResolvedValue({
      success: true,
      data: { active: true, accounts: [{ id: 'cash', name: 'Офіс', kind: 'cash' }] },
    })
    const onChange = vi.fn()
    render(<AccountSelect onChange={onChange} />)
    expect(await screen.findByRole('combobox')).toHaveValue('cash')
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('cash'))
  })
  it('requires a choice when multiple accounts are available', async () => {
    api.financeChoices.mockResolvedValue({
      success: true,
      data: {
        active: true,
        accounts: [
          { id: 'cash', name: 'Офіс', kind: 'cash' },
          { id: 'bank', name: 'Банк', kind: 'bank' },
        ],
      },
    })
    render(<AccountSelect />)
    expect(await screen.findByRole('combobox')).toBeRequired()
    expect(screen.getByRole('combobox')).toHaveValue('')
  })
  it('explains missing permissions instead of offering a foreign account', async () => {
    api.financeChoices.mockResolvedValue({ success: true, data: { active: true, accounts: [] } })
    render(<AccountSelect />)
    expect(await screen.findByText(/Немає доступних кас/)).toBeVisible()
  })
  it('surfaces loading failure', async () => {
    api.financeChoices.mockRejectedValue(new Error('offline'))
    render(<AccountSelect />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Не вдалося завантажити каси')
  })
})

describe('cash usability safeguards', () => {
  it('routes document payments to existing workflows without creating a duplicate', () => {
    render(<FinanceClient initial={fixture()} today="2026-11-10" />)
    fireEvent.click(screen.getByRole('button', { name: /Додати операцію/ }))
    expect(screen.getByRole('link', { name: /Оплата від клієнта/ })).toHaveAttribute(
      'href',
      '/work-orders'
    )
    expect(screen.getByRole('link', { name: /Оплата постачальнику/ })).toHaveAttribute(
      'href',
      '/settlements'
    )
    expect(api.postFinanceDocument).not.toHaveBeenCalled()
  })
  it('prefills the selected account and previews exact before/after balances', () => {
    render(<FinanceClient initial={fixture()} today="2026-11-10" />)
    fireEvent.click(screen.getByRole('button', { name: /Офіс.*Показати операції/ }))
    expect(screen.getByRole('button', { name: /Операції: Офіс/ })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /Додати операцію/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Інша витрата' }))
    expect(screen.getByLabelText('З рахунку')).toHaveValue('cash')
    fireEvent.change(screen.getByLabelText('Сума, грн'), { target: { value: '0,02' } })
    expect(screen.getByLabelText('Підсумок операції')).toHaveTextContent('100,01 грн → 99,99 грн')
  })
  it('loads actual permissions for each account and role rather than default grants', () => {
    const data = {
      ...fixture(),
      roles: [
        { id: 'role', name: 'Менеджер' },
        { id: 'viewer', name: 'Перегляд' },
      ],
      accountAccess: [{ accountId: 'cash', roleId: 'role', canRead: true, canPost: true }],
    }
    render(<FinanceClient initial={data} today="2026-11-10" />)
    fireEvent.click(screen.getByRole('button', { name: 'Налаштування' }))
    fireEvent.click(screen.getByRole('button', { name: 'Доступ ролей до кас' }))
    expect(screen.getByLabelText('Проведення операцій')).toBeChecked()
    fireEvent.change(screen.getByLabelText('Роль'), { target: { value: 'viewer' } })
    expect(screen.getByLabelText('Проведення операцій')).not.toBeChecked()
    expect(screen.getByLabelText('Перегляд залишків і рухів')).not.toBeChecked()
    expect(api.saveFinanceDirectory).not.toHaveBeenCalled()
  })
  it('shows bank-only fields only for a bank account', () => {
    render(<FinanceClient initial={fixture()} today="2026-11-10" />)
    fireEvent.click(screen.getByRole('button', { name: 'Налаштування' }))
    fireEvent.click(screen.getByRole('button', { name: 'Додати касу / рахунок' }))
    expect(screen.queryByLabelText('IBAN')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Тип'), { target: { value: 'bank' } })
    expect(screen.getByLabelText('IBAN')).toBeVisible()
    fireEvent.change(screen.getByLabelText('Тип'), { target: { value: 'cash' } })
    expect(screen.queryByLabelText('Дозволити від’ємний залишок банку')).not.toBeInTheDocument()
  })
  it('surfaces unlinked payments beside balances', () => {
    render(
      <FinanceClient
        initial={{
          ...fixture(),
          unlinkedCount: 1,
          unlinked: [{ id: 'p', date: '2026-11-10', amount: '10.00', provider: null, note: '' }],
        }}
        today="2026-11-10"
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent('Оплат без каси: 1')
    expect(screen.getByRole('status')).toHaveTextContent('Не створюйте їх повторно')
  })
  it('does not present stale balances as confirmed on loading failure', async () => {
    api.financeReport.mockRejectedValue(new Error('offline'))
    render(<FinanceClient initial={fixture()} today="2026-11-10" />)
    fireEvent.change(screen.getByLabelText('Залишки на кінець дати'), {
      target: { value: '2026-11-09' },
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('Не вдалося завантажити')
    expect(screen.getByRole('button', { name: 'Повторити' })).toBeVisible()
    expect(screen.queryByText('100,01 грн')).not.toBeInTheDocument()
  })
  it('edits a draft without posting or recreating it', async () => {
    api.updateFinanceDraft.mockResolvedValue({ success: true })
    render(
      <FinanceClient
        initial={{
          ...fixture(),
          drafts: [
            {
              id: 'draft',
              kind: 'expense',
              date: '2026-11-10',
              amount: '1.00',
              note: 'Original',
              sourceAccountId: 'cash',
              targetAccountId: null,
              categoryId: 'rent',
              counterpartyLabel: null,
            },
          ],
        }}
        today="2026-11-10"
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Редагувати' }))
    expect(screen.getByLabelText('Сума, грн')).toHaveValue('1.00')
    expect(screen.getByLabelText('Призначення')).toHaveValue('Original')
    fireEvent.change(screen.getByLabelText('Сума, грн'), { target: { value: '1,01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти зміни чернетки' }))
    await waitFor(() =>
      expect(api.updateFinanceDraft).toHaveBeenCalledWith(
        'draft',
        expect.objectContaining({ amount: '1,01', sourceAccountId: 'cash' })
      )
    )
    expect(api.postFinanceDocument).not.toHaveBeenCalled()
    expect(api.saveFinanceDraft).not.toHaveBeenCalled()
  })
})

describe('read-only reconciliation notice', () => {
  it('warns a reader without exposing payment details or offering reconciliation', () => {
    render(
      <FinanceClient
        initial={{
          ...fixture(),
          isAdmin: false,
          unlinkedCount: 2,
          unlinked: [],
          capabilities: {
            manage: false,
            post: false,
            draft: false,
            reverse: false,
            transfer: false,
          },
        }}
        today="2026-11-10"
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent('Оплат без каси: 2')
    expect(screen.getByRole('status')).toHaveTextContent('Зверніться до відповідального')
    expect(screen.queryByRole('button', { name: 'Звірити оплати' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Визначити касу' })).not.toBeInTheDocument()
  })
})
