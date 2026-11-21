import { useState } from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { PaymentsSection } from '@/features/vehicles/Components/service-detail/PaymentsSection'
import { WorkOrderLayoutProvider } from '@/components/work-order-layout-context'
vi.mock('@/features/finance/actions', () => ({
  financeChoices: async () => ({
    success: true,
    data: {
      active: true,
      accounts: [
        { id: 'cash', name: 'Cash' },
        { id: 'bank', name: 'Bank' },
      ],
    },
  }),
}))
afterEach(cleanup)
describe('Payment controls inside a work order autosave form', () => {
  it.each([
    'classic',
    'modern',
  ] as const)('keeps the first account selection and does not autosave the order (%s)', async (layout) => {
    const pay = vi.fn(async () => true)
    function Order() {
      const [edits, setEdits] = useState(0)
      return (
        <WorkOrderLayoutProvider value={layout}>
          <form onInput={() => setEdits((n) => n + 1)}>
            <output data-testid="order-edits">{edits}</output>
            <PaymentsSection
              payments={[]}
              paymentStatus="unpaid"
              manuallyPaid={false}
              totalPaid={0}
              displayTotal={100}
              balanceDue={100}
              currencyCode="UAH"
              onCreatePayment={pay}
              onDeletePayment={vi.fn()}
              onTogglePaid={vi.fn()}
              paymentLoading={false}
              deletingPayment={null}
            />
          </form>
        </WorkOrderLayoutProvider>
      )
    }
    render(<Order />)
    fireEvent.click(screen.getByRole('button', { name: 'Record Payment' }))
    await screen.findByRole('option', { name: 'Bank' })
    const select = screen.getByRole('combobox')
    // A native select emits input before change. The enclosing autosave used
    // to rerender its controlled child between these two browser events.
    fireEvent.input(select, { target: { value: 'bank' } })
    fireEvent.change(select)
    expect(select).toHaveValue('bank')
    expect(screen.getByTestId('order-edits')).toHaveTextContent('0')
    fireEvent.input(screen.getByLabelText('Amount'), { target: { value: '25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Payment' }))
    await waitFor(() => expect(pay).toHaveBeenCalledOnce())
    expect(pay).toHaveBeenCalledWith(
      expect.objectContaining({ moneyAccountId: 'bank', amountExact: '25' })
    )
    expect(screen.getByTestId('order-edits')).toHaveTextContent('0')
  })
})
