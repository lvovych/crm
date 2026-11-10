import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
const api = vi.hoisted(() => ({
  financeReport: vi.fn(),
  financeChoices: vi.fn(),
  postFinanceDocument: vi.fn(),
  saveFinanceDraft: vi.fn(),
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
  active: true,
  start: '2026-11-01',
  isAdmin: true,
  capabilities: { manage: true, post: true, draft: true, reverse: true, transfer: true },
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
  it('keeps the inactive workflow explicit and disables posting', () => {
    render(
      <FinanceClient initial={{ ...fixture(), active: false, start: null }} today="2026-11-10" />
    )
    expect(screen.getByText('Підготовка касового обліку')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Надходження' })).toBeDisabled()
    expect(screen.getAllByText('Не підтверджено').length).toBeGreaterThan(0)
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
    expect(screen.getByRole('button', { name: 'Виплата' })).toBeDisabled()
    expect(screen.queryByText('Налаштування та початкові залишки')).not.toBeInTheDocument()
  })
  it('sends decimal input unchanged and preserves fields on rejection', async () => {
    api.postFinanceDocument.mockResolvedValue({ success: false, error: 'Недостатньо коштів' })
    render(<FinanceClient initial={fixture()} today="2026-11-10" />)
    fireEvent.click(screen.getByRole('button', { name: 'Виплата' }))
    fireEvent.change(screen.getByLabelText('Сума, грн'), { target: { value: '10,01' } })
    fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Стаття'), {
      target: { value: 'rent' },
    })
    fireEvent.change(screen.getByLabelText('Примітка'), { target: { value: 'Оренда' } })
    fireEvent.click(screen.getByRole('button', { name: 'Провести' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Надходження' }))
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
