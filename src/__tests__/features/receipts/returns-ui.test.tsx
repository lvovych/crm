import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Returns } from '@/features/receipts/Returns'
const { send, refresh } = vi.hoisted(() => ({ send: vi.fn(), refresh: vi.fn() }))
vi.mock('@/features/receipts/return-actions', () => ({ createSupplierReturn: send }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
const data = {
  supplier: 'Supplier',
  enabled: true,
  documents: [],
  lines: [
    { id: 'a', name: 'Filter', unit: 'шт', unitPrice: '100', available: '2.000' },
    { id: 'b', name: 'Oil', unit: 'л', unitPrice: '200', available: '0.700' },
    { id: 'c', name: 'Returned', unit: 'шт', unitPrice: '50', available: '0.000' },
  ],
}
beforeEach(() => {
  send.mockReset()
  refresh.mockReset()
  send.mockResolvedValue({ success: true, data: 'return-id' })
})
function open() {
  const view = render(<Returns receiptId="receipt" data={data} canCreate />)
  fireEvent.click(screen.getByText('Створити повернення з накладної'))
  fireEvent.change(screen.getByLabelText('Причина повернення'), {
    target: { value: 'Wrong parts' },
  })
  return view
}
describe('supplier return form', () => {
  it('explains an exhausted receipt and disables selecting all', () => {
    render(
      <Returns
        receiptId="receipt"
        data={{ ...data, lines: data.lines.map((l) => ({ ...l, available: '0.000' })) }}
        canCreate
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent('Немає доступних позицій')
    fireEvent.click(screen.getByText('Створити повернення з накладної'))
    expect(
      screen.getByRole('button', { name: 'Повернути все доступне з накладної' })
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Провести повернення' })).toBeDisabled()
  })
  it('selects all available goods in one request, excludes exhausted lines and clears after success', async () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Повернути все доступне з накладної' }))
    expect(screen.getByLabelText('Повернути Oil')).toHaveValue(0.7)
    expect(screen.getByLabelText('Повернути Returned')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Провести повернення' }))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toMatchObject({
      receiptId: 'receipt',
      reason: 'Wrong parts',
      lines: [
        { id: 'a', quantity: '2.000' },
        { id: 'b', quantity: '0.700' },
      ],
    })
    expect(screen.getByLabelText('Причина повернення')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Провести повернення' })).toBeDisabled()
  })
  it('keeps the request key after a lost response and sends only the selected partial quantity', async () => {
    send.mockRejectedValueOnce(new Error('Connection lost'))
    open()
    fireEvent.change(screen.getByLabelText('Повернути Oil'), { target: { value: '0.1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Провести повернення' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Провести повернення' }))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0][0].id).toBe(send.mock.calls[1][0].id)
    expect(send.mock.calls[1][0].lines).toEqual([{ id: 'b', quantity: '0.1' }])
  })
  it('prevents duplicate in-flight submissions and displays the server error', async () => {
    let resolve!: (result: unknown) => void
    send.mockReturnValue(
      new Promise((r) => {
        resolve = r
      })
    )
    const view = open()
    fireEvent.change(screen.getByLabelText('Повернути Filter'), { target: { value: '1' } })
    const form = view.container.querySelector('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(send).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Причина повернення')).toBeDisabled()
    resolve({ success: false, error: 'Недостатньо товару' })
    expect(await screen.findByRole('alert')).toHaveTextContent('Недостатньо товару')
    expect(refresh).not.toHaveBeenCalled()
  })
  it.each([
    false,
    true,
  ])('hides creation without permission or an accounted receipt (%s)', (canCreate) => {
    render(
      <Returns receiptId="receipt" data={{ ...data, enabled: !canCreate }} canCreate={canCreate} />
    )
    expect(screen.queryByText('Створити повернення з накладної')).not.toBeInTheDocument()
  })
  it('links the posted document to its own page', () => {
    render(
      <Returns
        receiptId="receipt"
        data={{
          ...data,
          documents: [
            {
              id: 'return-id',
              number: 'ПП-1',
              date: '2026-11-18',
              reason: 'Return',
              lines: [{ name: 'Filter', unit: 'шт', quantity: '1', amount: '100.00' }],
            },
          ],
        }}
        canCreate={false}
      />
    )
    expect(screen.getByRole('link', { name: 'ПП-1' })).toHaveAttribute(
      'href',
      '/receipts/receipt/returns/return-id'
    )
  })
})
