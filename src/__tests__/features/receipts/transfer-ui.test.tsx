import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TransferGoods } from '@/features/receipts/TransferGoods'
const { send, refresh } = vi.hoisted(() => ({ send: vi.fn(), refresh: vi.fn() }))
vi.mock('@/features/receipts/transfer-actions', () => ({ transferFromReceipt: send }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
const data = {
  serviceOrders: [],
  orders: [{ id: 'order', open: true, works: [], label: 'Наряд 1' }],
  lines: ['a', 'b'].map((id) => ({
    id,
    name: id,
    article: id,
    unit: 'шт',
    received: '5',
    available: '5',
    stock: 5,
    unitPrice: '10',
    transfers: [],
  })),
}
beforeEach(() => {
  send.mockReset()
  refresh.mockReset()
  send.mockResolvedValue({ data: { serviceRecordId: 'order', vehicleId: 'vehicle', count: 1 } })
})
describe('receipt transfer controls', () => {
  it('sends only the selected row and allows a second intentional identical transfer with a new key', async () => {
    render(<TransferGoods receiptId="receipt" data={data} />)
    fireEvent.change(screen.getByLabelText('Наряд-замовлення'), { target: { value: 'order' } })
    fireEvent.change(screen.getByLabelText('Кількість a'), { target: { value: '1' } })
    fireEvent.click(screen.getAllByRole('button', { name: /^Додати в наряд$/ })[0])
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0][0].lines).toEqual([{ id: 'a', quantity: '1', unitPrice: '10' }])
    fireEvent.change(screen.getByLabelText('Кількість a'), { target: { value: '1' } })
    fireEvent.click(screen.getAllByRole('button', { name: /^Додати в наряд$/ })[0])
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2))
    expect(send.mock.calls[1][0].requestId).not.toBe(send.mock.calls[0][0].requestId)
  })
  it('selects all available rows for one atomic request', async () => {
    render(<TransferGoods receiptId="receipt" data={data} />)
    fireEvent.change(screen.getByLabelText('Наряд-замовлення'), { target: { value: 'order' } })
    fireEvent.click(screen.getByRole('button', { name: 'Вибрати всі товари' }))
    fireEvent.click(screen.getByRole('button', { name: 'Додати вибрані в наряд' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0][0].lines.map((l: { id: string }) => l.id)).toEqual(['a', 'b'])
  })
})
