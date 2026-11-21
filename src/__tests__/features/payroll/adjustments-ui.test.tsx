import { afterEach, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useState } from 'react'
import { AdjustmentFields } from '@/features/payroll/AdjustmentFields'
import { CommissionLines } from '@/features/payroll/CommissionLines'
import { withAdjustments, type SalaryAdjustment } from '@/features/payroll/adjustments'
import { details } from './ui-fixtures'
afterEach(cleanup)
describe('Adjustment rows', () => {
  it('adds, edits, changes the sign and removes a row', () => {
    function Editor() {
      const [rows, setRows] = useState<SalaryAdjustment[]>([])
      return <AdjustmentFields rows={rows} onChange={setRows} />
    }
    render(<Editor />)
    fireEvent.click(screen.getByRole('button', { name: '+ Додати премію' }))
    fireEvent.change(screen.getByLabelText('Сума коригування 1'), { target: { value: '123,45' } })
    fireEvent.change(screen.getByLabelText('Пояснення коригування 1'), {
      target: { value: 'Премія' },
    })
    fireEvent.change(screen.getByLabelText('Тип коригування 1'), { target: { value: 'deduction' } })
    expect(screen.getByLabelText('Тип коригування 1')).toHaveValue('deduction')
    expect(screen.getByLabelText('Сума коригування 1')).toHaveValue('123,45')
    fireEvent.click(screen.getByRole('button', { name: '− Додати утримання' }))
    expect(screen.getByLabelText('Тип коригування 2')).toHaveValue('deduction')
    fireEvent.change(screen.getByLabelText('Сума коригування 2'), { target: { value: '25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Видалити коригування 1' }))
    expect(screen.queryByLabelText('Тип коригування 2')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Сума коригування 1')).toHaveValue('25')
  })
  it('limits the number of rows', () => {
    render(
      <AdjustmentFields
        rows={Array.from({ length: 100 }, (_, i) => ({
          id: String(i),
          type: 'bonus',
          amount: '1',
          reason: 'Bonus',
        }))}
        onChange={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: '+ Додати премію' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '− Додати утримання' })).toBeDisabled()
  })
  it('displays saved explanations, signs and net total', () => {
    const rows: SalaryAdjustment[] = [
      {
        id: 'd4152be8-333d-4a3f-af23-01ba055ad338',
        type: 'bonus',
        amount: '100',
        reason: 'Якість',
      },
      {
        id: '8bd970c1-b8dd-45c8-ab7a-58db5d8962a3',
        type: 'deduction',
        amount: '25',
        reason: 'Коригування',
      },
    ]
    render(<CommissionLines details={withAdjustments(details, rows)} zone="Europe/Kyiv" />)
    expect(screen.getByText('Якість')).toBeInTheDocument()
    expect(screen.getByText('Коригування')).toBeInTheDocument()
    expect(screen.getByText('575,00 грн')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
