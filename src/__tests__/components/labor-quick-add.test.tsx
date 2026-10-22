import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LaborQuickAdd } from '@/features/vehicles/Components/service-edit/LaborQuickAdd'
import { searchLaborPresets } from '@/features/labor-presets/Lib/quickLabor'
import { LaborNumberInput } from '@/features/vehicles/Components/service-edit/LaborNumberInput'

const oil = {
  id: 'oil',
  name: 'Заміна оливи',
  description: 'ТО',
  items: [
    { description: 'Заміна оливи', hours: 1, rate: 500, pricingType: 'service', sortOrder: 0 },
  ],
}
const bundle = {
  id: 'bundle',
  name: 'ТО комплекс',
  description: null,
  items: oil.items,
  parts: [
    {
      name: 'Фільтр',
      brand: '---',
      partNumber: null,
      quantity: 1,
      unit: 'шт',
      unitPrice: 200,
      inventoryPartId: null,
      sortOrder: 0,
    },
  ],
}
const setup = (extra = {}) => {
  const onAdd = vi.fn(),
    onPackage = vi.fn(),
    onInput = vi.fn(),
    onSubmit = vi.fn((e) => e.preventDefault())
  render(
    <form onSubmit={onSubmit} onInput={onInput}>
      <LaborQuickAdd
        presets={[oil, bundle]}
        currencyCode="UAH"
        onAdd={onAdd}
        onPackage={onPackage}
        {...extra}
      />
    </form>
  )
  return { onAdd, onPackage, onInput, onSubmit, search: screen.getByRole('combobox') }
}
beforeEach(() => localStorage.clear())
describe('quick labor workflow', () => {
  it('searches synonyms and all words independent of order, ranks favorites', () => {
    expect(searchLaborPresets([oil, bundle], 'масла замена', [], [])).toEqual([oil, bundle])
    expect(searchLaborPresets([oil], 'мастила', [], [])).toEqual([oil])
    expect(searchLaborPresets([oil, bundle], '', ['bundle'], [oil.id])[0]).toEqual(bundle)
  })
  it('selects with Enter, edits decimal price, adds and returns focus without submitting or dirtying the outer form', () => {
    const { search, onAdd, onInput, onSubmit } = setup()
    fireEvent.input(search, { target: { value: 'олив' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    const quantity = screen.getByLabelText('Quantity')
    expect(quantity).toHaveFocus()
    fireEvent.change(quantity, { target: { value: '2' } })
    const price = screen.getByLabelText('Unit price')
    fireEvent.change(price, { target: { value: '450,50' } })
    fireEvent.keyDown(price, { key: 'Enter' })
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ hours: 2, rate: 450.5, total: 901 })
    )
    expect(search).toHaveFocus()
    expect(search).toHaveValue('')
    expect(onInput).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })
  it('ignores held Enter and requires explicit price for a one-off service', () => {
    const { search, onAdd } = setup()
    fireEvent.change(search, { target: { value: 'Інша послуга' } })
    fireEvent.keyDown(search, { key: 'Enter', repeat: true })
    expect(onAdd).not.toHaveBeenCalled()
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(screen.getByRole('alert')).toBeVisible()
    expect(onAdd).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Unit price'), { target: { value: '0' } })
    fireEvent.keyDown(screen.getByLabelText('Unit price'), { key: 'Enter' })
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ rate: 0, total: 0 }))
  })
  it('requires package preview even for quick-add shortcut', () => {
    const { search, onPackage } = setup()
    fireEvent.change(search, { target: { value: 'комплекс' } })
    fireEvent.keyDown(search, { key: 'Enter', ctrlKey: true })
    expect(onPackage).not.toHaveBeenCalled()
    expect(screen.getByText('Package contents — jobs and parts will be added')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Add and continue' }))
    expect(onPackage).toHaveBeenCalledWith(bundle)
  })
  it('retains a one-off draft on catalog save failure, allows retry without catalog save', async () => {
    const onSavePreset = vi.fn().mockRejectedValue(new Error('Forbidden'))
    const { search, onAdd } = setup({ onSavePreset })
    fireEvent.change(search, { target: { value: 'Нова робота' } })
    fireEvent.change(screen.getByLabelText('Unit price'), { target: { value: '100' } })
    fireEvent.click(screen.getByLabelText('Also save as a typical service'))
    fireEvent.click(screen.getByRole('button', { name: 'Add and continue' }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeVisible())
    expect(search).toHaveValue('Нова робота')
    expect(onAdd).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('Also save as a typical service'))
    fireEvent.click(screen.getByRole('button', { name: 'Add and continue' }))
    expect(onAdd).toHaveBeenCalledTimes(1)
  })
  it('does not add anything when locked', () => {
    const { onAdd } = setup({ locked: true })
    fireEvent.click(screen.getByRole('button', { name: 'Add and continue' }))
    expect(onAdd).not.toHaveBeenCalled()
  })
  it('commits inline numbers only when valid and changed', () => {
    const onCommit = vi.fn()
    render(<LaborNumberInput value={500} label="Price" onCommit={onCommit} />)
    const input = screen.getByLabelText('Price')
    fireEvent.blur(input)
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '-3' } })
    fireEvent.blur(input)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '250,50' } })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledWith(250.5)
  })
})
