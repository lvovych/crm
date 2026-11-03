import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, it, expect, vi } from 'vitest'
vi.mock('next-intl', async () => {
  const messages = (await import('../../../../messages/en/suppliers.json')).default
  const translate = (key: keyof typeof messages) => messages[key]
  return { useTranslations: () => translate }
})
const mocks = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), enabled: vi.fn() }))
vi.mock('@/features/suppliers/Actions/supplierActions', () => ({
  listSuppliers: mocks.list,
  getSupplier: mocks.detail,
  supplierDirectoryAvailable: mocks.enabled,
}))
import { SupplierPicker } from '@/features/suppliers/Components/SupplierPicker'
beforeEach(() => {
  vi.resetAllMocks()
  mocks.enabled.mockResolvedValue({ data: true })
  mocks.detail.mockResolvedValue({ data: { supplier: { name: 'Old supplier', isArchived: true } } })
  mocks.list.mockResolvedValue({
    data: {
      items: [
        {
          id: 'new',
          name: 'New supplier',
          contacts: [{ phone: '+380501234567', email: 'parts@example.test', isPrimary: true }],
        },
      ],
    },
  })
})
it('keeps an archived selection until the user changes it and displays contacts', async () => {
  const change = vi.fn()
  render(<SupplierPicker value="old" onChange={change} />)
  expect(await screen.findByText(/Old supplier/)).toHaveTextContent('Archived')
  expect(change).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Find supplier' }))
  expect(screen.getByRole('status')).toHaveTextContent('Loading')
  fireEvent.click(await screen.findByRole('button', { name: /New supplier/ }))
  expect(change).toHaveBeenCalledWith('new')
})
it('reports a failed lookup and stops the loading state', async () => {
  mocks.list.mockRejectedValue(new Error('offline'))
  render(<SupplierPicker value={null} onChange={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Find supplier' }))
  expect(await screen.findByRole('alert')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
})
it('does not expose the picker when rollout is disabled', async () => {
  mocks.enabled.mockResolvedValue({ data: false })
  render(<SupplierPicker value="old" onChange={vi.fn()} />)
  await waitFor(() => expect(mocks.enabled).toHaveBeenCalled())
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(mocks.list).not.toHaveBeenCalled()
})
