import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useServiceActions } from '@/features/vehicles/Components/service-page/useServiceActions'
import { useServiceFormState } from '@/features/vehicles/Components/service-page/useServiceFormState'
import { updateServiceRecord } from '@/features/vehicles/Actions/serviceActions'
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/glass-modal', () => ({ useGlassModal: () => ({ open: vi.fn() }) }))
vi.mock('@/components/confirm-dialog', () => ({ useConfirm: () => vi.fn() }))
vi.mock('@/features/vehicles/Actions/serviceActions', () => ({
  updateServiceRecord: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('@/features/payments/Actions/paymentActions', () => ({
  createPayment: vi.fn(),
  deletePayment: vi.fn(),
}))
vi.mock('@/features/sms/Actions/smsActions', () => ({ getSmsTemplates: vi.fn() }))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
describe('status and form writes stay independent', () => {
  it.each([
    true,
    false,
  ])('separateStatus=%s saves lines without changing the status contract', async (separateStatus) => {
    const record = { id: 'job', payments: [], manuallyPaid: false, attachments: [] } as never
    const initialData = {
      id: 'job',
      title: 'Brake repair',
      type: 'repair',
      status: 'pending',
      description: '',
      serviceDate: '2026-11-09',
      partItems: [{ name: 'Pad', quantity: 2, unitPrice: 12.34, total: 24.68 }],
      laborItems: [],
      concerns: [],
    } as never
    const { result } = renderHook(() => {
      const formState = useServiceFormState({
        vehicleId: null,
        initialData,
        record,
        defaultTaxRate: 0,
        currentUserName: 'Tester',
        locked: false,
      })
      return useServiceActions({
        record,
        vehicleId: null,
        currencyCode: 'UAH',
        formState,
        separateStatus,
      })
    })
    const form = document.createElement('form')
    form.innerHTML = '<input name="title" value="Brake repair">'
    await act(async () => {
      await result.current.handleSubmit({ preventDefault: vi.fn(), currentTarget: form } as never)
    })
    expect(updateServiceRecord).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(updateServiceRecord).mock.calls[0][0] as Record<string, unknown>
    expect(payload.partItems).toEqual([
      { name: 'Pad', quantity: 2, unitPrice: 12.34, total: 24.68 },
    ])
    if (separateStatus) expect(payload).not.toHaveProperty('status')
    else expect(payload.status).toBe('pending')
  })
})
