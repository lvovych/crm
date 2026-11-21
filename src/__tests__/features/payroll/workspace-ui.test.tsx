import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { PayrollWorkspace } from '@/features/payroll/PayrollWorkspace'
import { CommissionLines } from '@/features/payroll/CommissionLines'
import { presetPeriod } from '@/features/payroll/period-presets'
import { zonedDayKey } from '@/lib/timezone'
import { withAdjustments } from '@/features/payroll/adjustments'
import { details, workspace } from './ui-fixtures'
const actions = vi.hoisted(() => ({
  preview: vi.fn(),
  save: vi.fn(),
  post: vi.fn(),
  rule: vi.fn(),
  refresh: vi.fn(),
}))
vi.mock('@/features/payroll/document-actions', () => ({
  previewDocument: actions.preview,
  saveSalaryDocument: actions.save,
  postSalaryDocument: actions.post,
  saveCommissionRule: actions.rule,
}))
vi.mock('@/features/payroll/salary-payments', () => ({
  salaryPaymentOptions: vi.fn(),
  paySalaryDocument: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: actions.refresh }) }))
const click = async (name: string) => {
  const button = screen.getByRole('button', { name })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
}
beforeEach(() => {
  vi.clearAllMocks()
  actions.preview.mockResolvedValue({ success: true, data: { details, fingerprint: 'preview' } })
  actions.save.mockResolvedValue({
    success: true,
    data: { id: 'saved12345678', revision: 'saved-rev' },
  })
  actions.post.mockResolvedValue({ success: true, data: { id: 'saved12345678' } })
})
afterEach(cleanup)
describe('Salary workspace', () => {
  it('filters the journal by employee and status and opens immutable posted documents', async () => {
    render(<PayrollWorkspace data={workspace()} initial={{}} />)
    fireEvent.change(screen.getByLabelText('Працівник', { exact: true }), {
      target: { value: 'manager' },
    })
    expect(screen.queryByRole('button', { name: 'ЗП-12345678' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Статус', { exact: true }), { target: { value: 'new' } })
    expect(screen.getByText('Документів за вибраними умовами немає.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Статус', { exact: true }), {
      target: { value: 'completed' },
    })
    await click('ЗП-87654321')
    expect(screen.queryByRole('button', { name: 'Провести нарахування' })).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Документи нарахування' }).at(-1)!)
    expect(screen.getByRole('heading', { name: 'Документи нарахування' })).toBeInTheDocument()
  })
  it('creates, previews, saves a draft, then posts using the server revision', async () => {
    render(<PayrollWorkspace data={workspace()} initial={{}} />)
    await click('Створити нарахування')
    fireEvent.change(screen.getByLabelText('Працівник', { exact: true }), {
      target: { value: 'manager' },
    })
    expect(screen.getByText(/У старих налаштуваннях є оклад/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Початок періоду'), { target: { value: '2026-11-09' } })
    fireEvent.change(screen.getByLabelText('Кінець періоду включно'), {
      target: { value: '2026-11-15' },
    })
    fireEvent.change(screen.getByLabelText('Дата документа'), { target: { value: '2026-11-22' } })
    await click('Заповнити за правилами')
    await screen.findByRole('heading', { name: 'За що нараховано зарплату' })
    expect(actions.preview).toHaveBeenCalledWith({
      employee: 'manager',
      start: '2026-11-09',
      end: '2026-11-15',
    })
    await click('Зберегти чернетку')
    await screen.findByText('Чернетку збережено.')
    expect(actions.save).toHaveBeenCalledWith(
      expect.objectContaining({ existing: false, preview: 'preview', date: '2026-11-22' })
    )
    await click('Провести нарахування')
    await screen.findByText('Нарахування проведено. Суми зафіксовано.')
    expect(actions.post).toHaveBeenCalledWith({ id: 'saved12345678', revision: 'saved-rev' })
  })
  it('fills optional presets and restores manual mode when dates are edited', async () => {
    render(<PayrollWorkspace data={workspace()} initial={{ mode: 'new' }} />)
    const preset = screen.getByLabelText('Швидкий вибір періоду (необов’язково)')
    expect(preset).not.toBeRequired()
    const today = zonedDayKey(new Date(), workspace().zone)
    fireEvent.change(preset, { target: { value: 'currentFortnight' } })
    expect(screen.getByLabelText('Початок періоду')).toHaveValue(
      presetPeriod('currentFortnight', today).start
    )
    expect(screen.getByLabelText('Кінець періоду включно')).toHaveValue(
      presetPeriod('currentFortnight', today).end
    )
    fireEvent.change(preset, { target: { value: '' } })
    expect(screen.getByLabelText('Початок періоду')).toHaveValue(
      presetPeriod('currentFortnight', today).start
    )
    fireEvent.change(screen.getByLabelText('Кінець періоду включно'), {
      target: { value: '2026-12-01' },
    })
    expect(preset).toHaveValue('')
    fireEvent.change(preset, { target: { value: 'previousMonth' } })
    fireEvent.change(screen.getByLabelText('Початок періоду'), { target: { value: '2026-10-10' } })
    expect(preset).toHaveValue('')
  })
  it('validates adjustments, previews them and saves the server-calculated snapshot', async () => {
    render(<PayrollWorkspace data={workspace()} initial={{ mode: 'new' }} />)
    await click('+ Додати премію')
    fireEvent.change(screen.getByLabelText('Сума коригування 1'), { target: { value: '-1' } })
    fireEvent.change(screen.getByLabelText('Пояснення коригування 1'), {
      target: { value: 'Перевірка' },
    })
    await click('Заповнити за правилами')
    expect(actions.preview).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Сума коригування 1'), { target: { value: '100,25' } })
    fireEvent.change(screen.getByLabelText('Пояснення коригування 1'), {
      target: { value: 'Якість' },
    })
    const adjusted = withAdjustments(details, [
      {
        id: 'd4152be8-333d-4a3f-af23-01ba055ad338',
        type: 'bonus',
        amount: '100.25',
        reason: 'Якість',
      },
    ])
    actions.preview.mockResolvedValue({
      success: true,
      data: { details: adjusted, fingerprint: 'adjusted' },
    })
    await click('Заповнити за правилами')
    await screen.findByText('600,25 грн')
    expect(actions.preview).toHaveBeenCalledWith(
      expect.objectContaining({
        adjustments: [
          expect.objectContaining({ type: 'bonus', amount: '100.25', reason: 'Якість' }),
        ],
      })
    )
    await click('Зберегти чернетку')
    await screen.findByText('Чернетку збережено.')
    expect(actions.save).toHaveBeenCalledWith(
      expect.objectContaining({ adjustments: adjusted.adjustments, preview: 'adjusted' })
    )
    await click('Змінити премії та утримання')
    expect(screen.getByLabelText('Сума коригування 1')).toHaveValue('100,25')
  })
  it('opens adjustment-only drafts and keeps posted adjustments read-only', async () => {
    const data = workspace()
    const adjusted = withAdjustments({ ...details, lines: [] }, [
      {
        id: 'd4152be8-333d-4a3f-af23-01ba055ad338',
        type: 'bonus',
        amount: '100',
        reason: 'Разова премія',
      },
    ])
    data.documents[0].details = adjusted
    render(<PayrollWorkspace data={data} initial={{ slip: data.documents[0].id }} />)
    expect(screen.getByRole('button', { name: 'Провести нарахування' })).toBeEnabled()
    await click('Змінити премії та утримання')
    expect(screen.getByLabelText('Пояснення коригування 1')).toHaveValue('Разова премія')
    cleanup()
    data.documents[0].status = 'completed'
    render(<PayrollWorkspace data={data} initial={{ slip: data.documents[0].id }} />)
    expect(
      screen.queryByRole('button', { name: 'Змінити премії та утримання' })
    ).not.toBeInTheDocument()
  })
  it('recalculates an existing draft and saves it before posting', async () => {
    render(<PayrollWorkspace data={workspace()} initial={{ slip: 'draft12345678' }} />)
    await click('Перерахувати')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Зберегти чернетку' })).toBeEnabled()
    )
    await click('Провести нарахування')
    await screen.findByText('Нарахування проведено. Суми зафіксовано.')
    expect(actions.save).toHaveBeenCalledWith(
      expect.objectContaining({ existing: true, id: 'draft12345678', revision: 'rev1' })
    )
  })
  it('opens a draft from the journal, changes parameters and returns to the journal', async () => {
    render(<PayrollWorkspace data={workspace()} initial={{}} />)
    await click('ЗП-12345678')
    await click('Змінити параметри')
    expect(screen.getByLabelText('Початок періоду')).toHaveValue('2026-11-09')
    await click('До документів')
    await click('Створити нарахування')
    await click('Переглянути налаштування')
    expect(screen.getByRole('heading', { name: 'Правила працівників' })).toBeInTheDocument()
  })
  it('hides archives until requested and supports selecting an archived employee', async () => {
    render(<PayrollWorkspace data={workspace()} initial={{ mode: 'new' }} />)
    expect(screen.queryByRole('option', { name: /Архівний/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Показати також архівних працівників'))
    fireEvent.change(screen.getByLabelText('Працівник', { exact: true }), {
      target: { value: 'archive' },
    })
    expect(screen.getByRole('option', { name: /звільнено/ })).toBeInTheDocument()
  })
  it('updates the individual employee in rules and never offers editing without permission', async () => {
    const data = workspace()
    data.canManage = false
    render(<PayrollWorkspace data={data} initial={{ mode: 'rules' }} />)
    fireEvent.change(screen.getByLabelText('Працівник', { exact: true }), {
      target: { value: 'manager' },
    })
    expect(screen.queryByRole('button', { name: '+ Додати правило' })).not.toBeInTheDocument()
    await click('Документи нарахування')
    expect(screen.queryByRole('button', { name: 'Створити нарахування' })).not.toBeInTheDocument()
  })
  it.each([
    ['preview', 'Немає правил'],
    ['save', 'Дані змінилися'],
    ['post', 'Наряд відкрито'],
  ])('shows a %s failure and does not claim success', async (kind, message) => {
    actions[kind as 'preview' | 'save' | 'post'].mockResolvedValue({
      success: false,
      error: message,
    })
    render(
      <PayrollWorkspace
        data={workspace()}
        initial={kind === 'post' ? { slip: 'draft12345678' } : { mode: 'new' }}
      />
    )
    if (kind === 'post') await click('Провести нарахування')
    else {
      await click('Заповнити за правилами')
      if (kind === 'save') {
        await screen.findByRole('heading', { name: 'За що нараховано зарплату' })
        await click('Зберегти чернетку')
      }
    }
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
  it.each([
    'preview',
    'save',
    'post',
  ] as const)('has a useful fallback for an empty %s error', async (kind) => {
    actions[kind].mockResolvedValue({ success: false })
    render(
      <PayrollWorkspace
        data={workspace()}
        initial={kind === 'post' ? { slip: 'draft12345678' } : { mode: 'new' }}
      />
    )
    if (kind === 'post') await click('Провести нарахування')
    else {
      await click('Заповнити за правилами')
      if (kind === 'save') {
        await screen.findByRole('heading', { name: 'За що нараховано зарплату' })
        await click('Зберегти чернетку')
      }
    }
    expect(await screen.findByRole('alert')).toHaveTextContent('Не вдалося')
  })
  it('does not allow posting an empty result', async () => {
    actions.preview.mockResolvedValue({
      data: { details: { ...details, lines: [], total: '0.00' }, fingerprint: 'empty' },
    })
    render(<PayrollWorkspace data={workspace()} initial={{ mode: 'new' }} />)
    await click('Заповнити за правилами')
    await screen.findByText(/За цей період немає нарахувань/)
    expect(screen.getByRole('button', { name: 'Провести нарахування' })).toBeDisabled()
  })
  it.each(['new', 'completed'])('shows a legacy %s document without rewriting it', (status) => {
    const data = workspace()
    data.documents[0].status = status
    data.documents[0].details = { lines: [], conditions: [] }
    render(<PayrollWorkspace data={data} initial={{ slip: data.documents[0].id }} />)
    expect(screen.getByText(/Документ попередньої версії/)).toBeInTheDocument()
  })
  it('handles an absent document and an empty roster', async () => {
    const { unmount } = render(
      <PayrollWorkspace data={workspace()} initial={{ slip: 'missing' }} />
    )
    expect(screen.getByText(/Документ не знайдено/)).toBeInTheDocument()
    unmount()
    render(<PayrollWorkspace data={{ ...workspace(), people: [] }} initial={{}} />)
    expect(screen.getByRole('link', { name: 'Додайте працівника' })).toHaveAttribute(
      'href',
      '/employees'
    )
  })
  it('keeps unresolved-assignment warnings and links each order in itemized details', async () => {
    render(
      <CommissionLines
        details={{
          ...details,
          warnings: ['Неоднозначний виконавець'],
          lines: [
            ...details.lines,
            {
              ...details.lines[0],
              orderId: 'other',
              lineId: 'other',
              vehicleId: null,
              executorLabel: null,
            },
          ],
        }}
        zone="Europe/Kyiv"
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Неоднозначний виконавець')
    expect(screen.getByRole('link', { name: 'Відкрити наряд' })).toHaveAttribute(
      'href',
      '/vehicles/v/service/o'
    )
    expect(
      within(screen.getByRole('alert')).getByText('Неоднозначний виконавець')
    ).toBeInTheDocument()
  })
})
