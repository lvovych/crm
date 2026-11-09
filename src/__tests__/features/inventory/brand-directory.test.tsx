import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrandDirectory } from '@/features/inventory/Components/BrandDirectory'
const { save, availability, refresh } = vi.hoisted(() => ({
  save: vi.fn(),
  availability: vi.fn(),
  refresh: vi.fn(),
}))
vi.mock('@/features/inventory/Actions/manageBrands', () => ({
  saveBrand: save,
  changeBrandAvailability: availability,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
const brands = [
  { id: 'a', name: 'Alpha', isActive: true },
  { id: 'b', name: 'Beta', isActive: false },
  { id: 'brand_unknown', name: '---', isActive: true },
]
beforeEach(() => {
  vi.clearAllMocks()
  save.mockResolvedValue({ success: true })
  availability.mockResolvedValue({ success: true })
})
describe('brand directory controls', () => {
  it.each([
    [false, false, false],
    [true, false, false],
    [false, true, false],
    [false, false, true],
    [true, true, true],
  ])('honors create=%s edit=%s delete=%s independently', (canCreate, canEdit, canDelete) => {
    render(
      <BrandDirectory
        brands={brands}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    )
    expect(screen.queryAllByRole('button', { name: 'Додати бренд' })).toHaveLength(
      canCreate ? 1 : 0
    )
    expect(screen.queryAllByRole('button', { name: 'Редагувати' })).toHaveLength(canEdit ? 3 : 0)
    expect(screen.queryAllByRole('button', { name: 'Видалити (деактивувати)' })).toHaveLength(
      canDelete ? 1 : 0
    )
    expect(screen.queryAllByRole('button', { name: 'Відновити' })).toHaveLength(canEdit ? 1 : 0)
    if (canEdit)
      expect(within(screen.getByRole('row', { name: /---/ })).getByRole('button')).toBeDisabled()
  })
  it('filters case-insensitively and cancel does not save', () => {
    render(<BrandDirectory brands={brands} canCreate canEdit canDelete />)
    fireEvent.change(screen.getByLabelText('Пошук бренду'), { target: { value: 'ALP' } })
    expect(screen.getByRole('row', { name: /Alpha/ })).toBeInTheDocument()
    expect(screen.queryByRole('row', { name: /Beta/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Додати бренд' }))
    fireEvent.change(screen.getByLabelText('Назва'), { target: { value: 'New' } })
    fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }))
    expect(save).not.toHaveBeenCalled()
  })
  it('keeps a failed edit available for correction without refreshing', async () => {
    save.mockResolvedValue({ success: false, error: 'Duplicate brand' })
    render(<BrandDirectory brands={brands} canCreate canEdit canDelete />)
    fireEvent.click(
      within(screen.getByRole('row', { name: /Alpha/ })).getByRole('button', { name: 'Редагувати' })
    )
    fireEvent.change(screen.getByLabelText('Назва'), { target: { value: 'Beta' } })
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Duplicate brand'))
    expect(screen.getByLabelText('Назва')).toHaveValue('Beta')
    expect(refresh).not.toHaveBeenCalled()
    save.mockResolvedValue({ success: true })
    fireEvent.change(screen.getByLabelText('Назва'), { target: { value: 'Gamma' } })
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(screen.queryByLabelText('Назва')).not.toBeInTheDocument()
  })
  it('deactivates and restores using the separate availability action', async () => {
    render(<BrandDirectory brands={brands} canCreate canEdit canDelete />)
    fireEvent.click(screen.getByRole('button', { name: 'Видалити (деактивувати)' }))
    await waitFor(() => expect(availability).toHaveBeenCalledWith('a', false))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Бренд деактивовано'))
    fireEvent.click(screen.getByRole('button', { name: 'Відновити' }))
    await waitFor(() => expect(availability).toHaveBeenCalledWith('b', true))
    expect(save).not.toHaveBeenCalled()
  })
})
