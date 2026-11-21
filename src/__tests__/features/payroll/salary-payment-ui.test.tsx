import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { SalaryPayment } from '@/features/payroll/SalaryPayment'
const actions = vi.hoisted(() => ({ options: vi.fn(), pay: vi.fn(), refresh: vi.fn() }))
vi.mock('@/features/payroll/salary-payments', () => ({
  salaryPaymentOptions: actions.options,
  paySalaryDocument: actions.pay,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: actions.refresh }) }))
const defaults = {
  remaining: '450.00',
  today: '2026-11-21',
  categoryName: 'Зарплати',
  accounts: [{ id: 'cash', name: 'Каса сервісу' }],
}
beforeEach(() => {
  vi.clearAllMocks()
  actions.options.mockResolvedValue({ success: true, data: defaults })
  actions.pay.mockResolvedValue({ success: true, data: { documentId: 'paid' } })
})
afterEach(cleanup)
async function open() {
  render(<SalaryPayment slipId="slip" />)
  fireEvent.click(screen.getByRole('button', { name: 'Провести виплату' }))
  await screen.findByRole('dialog')
}
describe('Pay a salary document', () => {
  it('prefills the balance, category, date and only account, allows editing and posts', async () => {
    await open()
    await screen.findByLabelText('Сума виплати, грн')
    expect(screen.getByLabelText('Сума виплати, грн')).toHaveValue('450.00')
    expect(screen.getByLabelText('Стаття витрат')).toHaveValue('Зарплати')
    expect(screen.getByLabelText('Каса / рахунок')).toHaveValue('cash')
    fireEvent.change(screen.getByLabelText('Сума виплати, грн'), { target: { value: '100,25' } })
    fireEvent.change(screen.getByLabelText('Дата виплати'), { target: { value: '2026-11-20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Підтвердити виплату' }))
    await screen.findByText('Виплату проведено по касі.')
    expect(actions.pay).toHaveBeenCalledWith({
      slipId: 'slip',
      requestId: expect.any(String),
      amount: '100,25',
      date: '2026-11-20',
      account: 'cash',
    })
    expect(actions.refresh).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('requires choosing between accounts and permits canceling without a payment', async () => {
    actions.options.mockResolvedValue({
      data: { ...defaults, accounts: [...defaults.accounts, { id: 'bank', name: 'Банк' }] },
    })
    await open()
    await screen.findByLabelText('Каса / рахунок')
    expect(screen.getByLabelText('Каса / рахунок')).toHaveValue('')
    fireEvent.change(screen.getByLabelText('Каса / рахунок'), { target: { value: 'bank' } })
    fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }))
    expect(actions.pay).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it.each([undefined, 'Немає доступу'])('displays option loading errors %s', async (error) => {
    actions.options.mockResolvedValue({ success: false, error })
    await open()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      error || 'Не вдалося завантажити дані виплати.'
    )
    expect(screen.queryByRole('button', { name: 'Підтвердити виплату' })).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  })
  it('prevents a new payout when fully paid or no cash account is accessible', async () => {
    actions.options.mockResolvedValue({ data: { ...defaults, remaining: '0.00' } })
    await open()
    await screen.findByText('За цим документом немає залишку до виплати.')
    cleanup()
    actions.options.mockResolvedValue({ data: { ...defaults, accounts: [] } })
    await open()
    await screen.findByText('Немає доступної каси для виплати.')
    expect(screen.getByRole('button', { name: 'Підтвердити виплату' })).toBeDisabled()
  })
  it.each([
    undefined,
    'Недостатньо коштів',
  ])('keeps the request ID for a retry after payment failure %s', async (error) => {
    actions.pay.mockResolvedValue({ success: false, error })
    await open()
    await screen.findByLabelText('Сума виплати, грн')
    fireEvent.click(screen.getByRole('button', { name: 'Підтвердити виплату' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      error || 'Не вдалося провести виплату.'
    )
    const requestId = actions.pay.mock.calls[0][0].requestId
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Підтвердити виплату' })).toBeEnabled()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Підтвердити виплату' }))
    await waitFor(() => expect(actions.pay).toHaveBeenCalledTimes(2))
    expect(actions.pay.mock.calls[1][0].requestId).toBe(requestId)
  })
})
