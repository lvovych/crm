import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, it, expect, vi } from 'vitest'
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
const save = vi.hoisted(() => vi.fn())
vi.mock('@/features/suppliers/Actions/supplierActions', () => ({ saveSupplier: save }))
import { SupplierEditor } from '@/features/suppliers/Components/SupplierEditor'
beforeEach(() => {
  save.mockReset()
  save.mockResolvedValue({ success: false, error: 'Review error' })
})
it('keeps empty payment terms distinct from zero when creating a supplier', async () => {
  render(<SupplierEditor />)
  fireEvent.change(screen.getByLabelText('Display name'), {
    target: { value: 'Workshop supplier' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(save).toHaveBeenCalled())
  expect(save.mock.calls[0][0]).toMatchObject({ name: 'Workshop supplier', paymentTermDays: null })
  expect(await screen.findByRole('alert')).toHaveTextContent('Review error')
})
it('can add contact and bank account without submitting the supplier', () => {
  render(<SupplierEditor />)
  fireEvent.click(screen.getByRole('button', { name: 'Add contact' }))
  fireEvent.click(screen.getByRole('button', { name: 'Add account' }))
  expect(screen.getByLabelText('Contact name')).toBeInTheDocument()
  expect(screen.getByLabelText('IBAN / account number')).toBeInTheDocument()
  expect(save).not.toHaveBeenCalled()
})
