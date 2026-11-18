import { afterEach, describe, expect, it, vi } from 'vitest'
const { post, validate, zone, tx } = vi.hoisted(() => ({
  post: vi.fn().mockResolvedValue('return-id'),
  validate: vi.fn().mockResolvedValue(undefined),
  zone: vi.fn(),
  tx: {},
}))
vi.mock('@/lib/with-auth', () => ({
  withAuth: async (fn: (ctx: unknown) => Promise<unknown>) => ({
    success: true,
    data: await fn({ organizationId: 'org', userId: 'manager' }),
  }),
}))
vi.mock('@/lib/db', () => ({
  db: { $transaction: async (fn: (client: unknown) => Promise<unknown>) => fn(tx) },
}))
vi.mock('@/features/finance/ledger', () => ({ lockFinance: vi.fn() }))
vi.mock('@/features/finance/access', () => ({ assertOperationDate: validate }))
vi.mock('@/lib/workshop-timezone', () => ({ workshopTimeZone: zone }))
vi.mock('@/features/receipts/enabled', () => ({ receiptsEnabled: () => true }))
vi.mock('@/features/receipts/return-ledger', () => ({ postSupplierReturn: post }))
vi.mock('@/features/inventory/Lib/onInventoryChanged', () => ({ onInventoryChanged: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { createSupplierReturn } from '@/features/receipts/return-actions'

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})
describe('return date at the workshop midnight boundary', () => {
  it.each([
    ['UTC', '2026-11-17'],
    ['Europe/Kyiv', '2026-11-18'],
    ['America/Los_Angeles', '2026-11-17'],
  ])('validates and posts the same local date in %s', async (timeZone, expected) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-17T22:30:00Z'))
    zone.mockResolvedValue(timeZone)
    await createSupplierReturn({ receiptId: 'receipt' })
    expect(validate).toHaveBeenCalledWith({ organizationId: 'org', userId: 'manager' }, expected)
    expect(post).toHaveBeenCalledWith(
      tx,
      'org',
      'manager',
      { receiptId: 'receipt' },
      expected,
      'draft'
    )
  })
})
