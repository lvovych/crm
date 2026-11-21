import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { IndividualRules } from '@/features/payroll/IndividualRules'
import { rule } from './ui-fixtures'
const save = vi.hoisted(() => vi.fn())
vi.mock('@/features/payroll/document-actions', () => ({ saveCommissionRule: save }))
beforeEach(() => {
  save.mockReset()
  save.mockResolvedValue({ success: true })
})
afterEach(cleanup)
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
const date = () =>
  fireEvent.change(screen.getByLabelText('Діє з'), { target: { value: '2026-11-01' } })
describe('Individual percentage rules', () => {
  it('creates a workshop manager rule with independent date and switches calculation bases', async () => {
    const changed = vi.fn()
    render(
      <IndividualRules
        person={{ id: 'manager', roles: ['advisor'], rules: [] }}
        canManage
        today="2026-11-21"
        onChanged={changed}
      />
    )
    click('+ Додати правило')
    expect(screen.getByLabelText('Які позиції враховувати')).toHaveValue('workshop')
    fireEvent.change(screen.getByLabelText('Назва правила'), {
      target: { value: 'Менеджер — роботи' },
    })
    fireEvent.change(screen.getByLabelText('База нарахування'), {
      target: { value: 'managerLabor' },
    })
    fireEvent.change(screen.getByLabelText('Ставка, %'), { target: { value: '7.5' } })
    date()
    fireEvent.click(screen.getByLabelText(/Дозволити одночасне нарахування/))
    click('Зберегти правило')
    await waitFor(() => expect(changed).toHaveBeenCalledOnce())
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        employee: 'manager',
        allowOverlap: true,
        rule: expect.objectContaining({
          basis: 'managerLabor',
          scope: 'workshop',
          rate: '7.5',
          effective: '2026-11-01',
          deductMechanicPay: true,
          deductSubcontractCost: true,
        }),
      })
    )
  })
  it('edits the latest version, keeps history, and can suspend it without deleting old rules', async () => {
    const changed = vi.fn()
    render(
      <IndividualRules
        person={{
          id: 'mech',
          rules: [
            rule,
            {
              ...rule,
              id: 'r2',
              rate: '50',
              createdAt: '2026-11-12T00:00:00Z',
              effective: '2026-11-12',
            },
          ],
        }}
        canManage
        today="2026-11-21"
        onChanged={changed}
      />
    )
    expect(screen.getByText('50%')).toBeInTheDocument()
    click('Змінити умови')
    expect(screen.getByLabelText('Ставка, %')).toHaveValue(50)
    fireEvent.click(screen.getByLabelText('Правило активне з обраної дати'))
    fireEvent.click(screen.getByLabelText('Враховувати знижки клієнту'))
    click('Зберегти правило')
    await waitFor(() => expect(changed).toHaveBeenCalled())
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        ruleKey: 'r',
        previous: 'r2',
        rule: expect.objectContaining({ enabled: false, afterDiscount: false, scope: 'performer' }),
      })
    )
  })
  it.each(['Conflict', undefined])('preserves the form on server failure %s', async (error) => {
    save.mockResolvedValue({ success: false, error })
    render(
      <IndividualRules
        person={{ id: 'm', rules: [] }}
        canManage
        today="2026-11-21"
        onChanged={vi.fn()}
      />
    )
    click('+ Додати правило')
    click('Зберегти правило')
    expect(await screen.findByRole('alert')).toHaveTextContent(error || 'Не вдалося зберегти.')
    click('Скасувати')
    expect(screen.queryByLabelText('Назва правила')).not.toBeInTheDocument()
  })
  it('sets a mechanic-only scope for own work and seller scope for parts', async () => {
    render(
      <IndividualRules
        person={{ id: 'm', rules: [] }}
        canManage
        today="2026-11-21"
        onChanged={vi.fn()}
      />
    )
    click('+ Додати правило')
    expect(screen.getByLabelText('Які позиції враховувати')).toHaveValue('manager')
    fireEvent.change(screen.getByLabelText('База нарахування'), { target: { value: 'labor' } })
    expect(screen.getByLabelText('Які позиції враховувати')).toHaveValue('performer')
    fireEvent.change(screen.getByLabelText('База нарахування'), { target: { value: 'partsSales' } })
    fireEvent.change(screen.getByLabelText('Які позиції враховувати'), {
      target: { value: 'seller' },
    })
    fireEvent.click(screen.getByLabelText(/Враховувати від’ємну базу/))
    click('Зберегти правило')
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        rule: expect.objectContaining({
          basis: 'partsSales',
          scope: 'seller',
          includeNegative: true,
        }),
      })
    )
  })
  it('shows suspended rules and all scope descriptions without edit controls for read-only viewers', () => {
    render(
      <IndividualRules
        person={{
          id: 'm',
          rules: [
            rule,
            ...(['seller', 'manager', 'workshop'] as const).map((scope, i) => ({
              ...rule,
              id: scope,
              ruleKey: scope,
              scope,
              basis: 'managerLabor' as const,
              enabled: false,
              afterDiscount: false,
              deductMechanicPay: true,
              createdAt: `2026-11-0${i + 2}T00:00:00Z`,
            })),
          ],
        }}
        canManage={false}
        today="2026-11-21"
        onChanged={vi.fn()}
      />
    )
    expect(screen.getByText(/продавець запчастин/)).toBeInTheDocument()
    expect(screen.getByText(/усі наряди сервісу/)).toBeInTheDocument()
    expect(screen.getAllByText(/Призупинено/)).toHaveLength(3)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
  it('orders same-day version history deterministically and cancels a rule edit', () => {
    render(
      <IndividualRules
        person={{
          id: 'm',
          rules: [
            { ...rule, id: 'b' },
            { ...rule, id: 'a', rate: '30' },
          ],
        }}
        canManage
        today="2026-11-21"
        onChanged={vi.fn()}
      />
    )
    click('Змінити умови')
    expect(screen.getByLabelText('Ставка, %')).toHaveValue(40)
    click('Скасувати')
    expect(screen.queryByText('Нова версія правила')).not.toBeInTheDocument()
  })
})
