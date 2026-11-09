import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StatusStepper } from '@/features/vehicles/Components/service-page/modern/StatusStepper'
import { updateServiceSchema } from '@/features/vehicles/Schema/serviceSchema'

afterEach(cleanup)
function open() {
  fireEvent.click(screen.getByRole('button', { name: /^Work order status/ }))
  return within(screen.getByRole('dialog'))
}
describe('explicit work order status control', () => {
  it.each([
    ['pending', 'Pending'],
    ['in-progress', 'In Progress'],
    ['waiting-parts', 'Waiting Parts'],
    ['completed', 'Completed'],
  ])('selects %s through a fully named control', (status, name) => {
    const change = vi.fn()
    render(
      <StatusStepper status={status === 'pending' ? 'completed' : 'pending'} onChange={change} />
    )
    const dialog = open()
    for (const label of ['Pending', 'In Progress', 'Waiting Parts', 'Completed'])
      expect(dialog.getByRole('button', { name: label })).toBeVisible()
    fireEvent.click(dialog.getByRole('button', { name }))
    expect(change).toHaveBeenCalledExactlyOnceWith(status, null)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('marks the current choice and does not write it again', () => {
    const change = vi.fn()
    render(<StatusStepper status="pending" onChange={change} />)
    const selected = open().getByRole('button', { name: 'Pending' })
    expect(selected).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(selected)
    expect(change).not.toHaveBeenCalled()
  })
  it('retains custom names, stage and notification metadata', () => {
    const custom = {
      id: 'custom',
      name: 'Ready for pickup',
      stage: 'completed' as const,
      color: 'emerald' as const,
      notifyCustomer: true,
      messageTemplate: null,
    }
    const change = vi.fn()
    render(<StatusStepper status="pending" options={[custom]} onChange={change} />)
    fireEvent.click(open().getByRole('button', { name: /Ready for pickup/ }))
    expect(change).toHaveBeenCalledWith('completed', custom)
  })
  it('shows archived current custom status without offering it as a new choice', () => {
    render(
      <StatusStepper
        status="completed"
        customStatus={{ id: 'old', name: 'Historical status', color: 'blue' }}
        onChange={vi.fn()}
      />
    )
    expect(screen.getByTestId('current-status')).toHaveTextContent('Historical status')
    expect(open().queryByRole('button', { name: /Historical status/ })).not.toBeInTheDocument()
  })
  it('blocks repeated input while saving and announces feedback', () => {
    render(<StatusStepper status="pending" saving message="Saved" onChange={vi.fn()} />)
    expect(screen.getByRole('button')).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Saving…')
  })
  it('shows a failed save without displaying an unpersisted status', () => {
    render(<StatusStepper status="pending" message="Could not save" onChange={vi.fn()} />)
    expect(screen.getByTestId('current-status')).toHaveTextContent('Pending')
    expect(screen.getByRole('status')).toHaveTextContent('Could not save')
  })
})
describe('partial saves cannot reset the independently saved status', () => {
  it('omits status on an unrelated edit', () =>
    expect(updateServiceSchema.parse({ id: 'job', title: 'Edited' }).status).toBeUndefined())
  it.each([
    'pending',
    'in-progress',
    'waiting-parts',
    'completed',
  ])('keeps an explicit classic status %s', (status) =>
    expect(updateServiceSchema.parse({ id: 'job', status }).status).toBe(status))
  it('rejects unsupported statuses', () =>
    expect(updateServiceSchema.safeParse({ id: 'job', status: 'paid' }).success).toBe(false))
})
