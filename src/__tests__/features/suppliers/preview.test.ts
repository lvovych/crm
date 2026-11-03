import { describe, it, expect } from 'vitest'
import {
  supplierSnapshotSchema,
  buildSupplierPreview,
  type ExistingSupplier,
} from '@/features/suppliers/Lib/preview'
import { supplierSchema } from '@/features/suppliers/Schema/supplierSchema'
import { assertLegacySupplierChange } from '@/features/suppliers/Lib/inventorySupplier'
const raw = () => ({
  version: 1,
  source: 'carbook',
  sourceAccountId: 'shop',
  periodStart: '2023-11-02T22:00:00Z',
  snapshotAt: '2026-11-03T12:00:00Z',
  coverage: { suppliers: true, goods: true, services: true, returns: true, payments: true },
  suppliers: [{ externalId: 's1', data: { name: 'Acme' } }],
  movements: [] as Record<string, unknown>[],
})
const movement = (changes: Record<string, unknown> = {}) => ({
  externalId: 'm1',
  supplierId: 's1',
  kind: 'goods_receipt',
  date: '2024-05-01T12:00:00Z',
  status: 'posted',
  quantity: 1,
  amount: 100,
  ...changes,
})
function run(changes: Record<string, unknown> = {}, existing: ExistingSupplier[] = []) {
  return buildSupplierPreview(supplierSnapshotSchema.parse({ ...raw(), ...changes }), existing)
}
describe('Supplier migration eligibility', () => {
  it.each([
    'goods_receipt',
    'service_receipt',
    'goods_return',
    'service_return',
    'payment',
    'refund',
  ])('accepts posted %s', (kind) => {
    expect(run({ movements: [movement({ kind })] }).items[0].decision).toBe('eligible')
  })
  it.each(['draft', 'deleted', 'cancelled'])('excludes %s', (status) =>
    expect(run({ movements: [movement({ status })] }).items[0].decision).toBe('excluded'))
  it.each(['order', 'opening_balance', 'debt_adjustment'])('excludes %s', (kind) =>
    expect(run({ movements: [movement({ kind })] }).items[0].decision).toBe('excluded'))
  it('uses inclusive instants, not creation date', () => {
    expect(run({ movements: [movement({ date: raw().periodStart })] }).items[0].decision).toBe(
      'eligible'
    )
    expect(run({ movements: [movement({ date: '2023-11-02T21:59:59Z' })] }).items[0].decision).toBe(
      'excluded'
    )
    expect(run({ movements: [movement({ date: raw().snapshotAt })] }).items[0].decision).toBe(
      'eligible'
    )
    expect(run({ movements: [movement({ date: '2026-11-03T12:00:01Z' })] }).items[0].decision).toBe(
      'excluded'
    )
  })
  it('does not qualify zero movement or technical reversals', () => {
    expect(
      run({
        movements: [
          movement({ quantity: 0 }),
          movement({ externalId: 'm2', kind: 'payment', amount: 0 }),
          movement({ externalId: 'm3', technicalReversal: true }),
        ],
      }).items[0].decision
    ).toBe('excluded')
  })
  it('does not exclude suppliers based on missing coverage', () => {
    const p = run({ coverage: { ...raw().coverage, payments: false } })
    expect(p.complete).toBe(false)
    expect(p.items[0].decision).toBe('uncertain')
  })
  it('flags unknown dates and orphan supplier references', () => {
    expect(run({ movements: [movement({ date: null })] }).items[0].decision).toBe('uncertain')
    expect(run({ movements: [movement({ supplierId: 'foreign' })] }).complete).toBe(false)
  })
  it('deduplicates identical evidence and preserves archive and debt exceptions', () => {
    const p = run({
      suppliers: [
        { externalId: 's1', isArchived: true, hasOutstandingBalance: true, data: { name: 'Acme' } },
      ],
      movements: [movement(), movement()],
    })
    expect(p.items[0].evidence).toHaveLength(1)
    expect(p.items[0].isArchived).toBe(true)
    expect(p.items[0].hasOutstandingBalance).toBe(true)
  })
  it('never merges by name or tax ID', () => {
    const p = run({ movements: [movement()] }, [
      { id: 'local', name: 'ACME', taxId: null, contacts: [], sourceLinks: [] },
    ])
    expect(p.items[0].decision).toBe('review')
    expect(p.items[0].conflicts[0].reason).toBe('name')
  })
  it('source identity is scoped to account and preserves existing data', () => {
    const existing = [
      {
        id: 'local',
        name: 'User edited',
        taxId: null,
        contacts: [],
        sourceLinks: [{ source: 'carbook', sourceAccountId: 'shop', externalSupplierId: 's1' }],
      },
    ]
    expect(run({ movements: [movement()] }, existing).items[0].decision).toBe('alreadyLinked')
    expect(existing[0].name).toBe('User edited')
    existing[0].sourceLinks[0].sourceAccountId = 'other'
    expect(run({ movements: [movement()] }, existing).items[0].decision).toBe('eligible')
  })
  it('rejects duplicate source IDs', () =>
    expect(() => run({ suppliers: [...raw().suppliers, ...raw().suppliers] })).toThrow())
})
describe('Directory compatibility', () => {
  it('distinguishes unknown from zero payment terms', () => {
    expect(supplierSchema.parse({ name: 'Acme' }).paymentTermDays).toBeNull()
    expect(supplierSchema.parse({ name: 'Acme', paymentTermDays: 0 }).paymentTermDays).toBe(0)
    expect(() => supplierSchema.parse({ name: 'Acme', paymentTermDays: -1 })).toThrow()
  })
  it('rejects executable website links and multiple primary contacts', () => {
    expect(() => supplierSchema.parse({ name: 'Acme', website: 'javascript:alert(1)' })).toThrow()
    expect(() =>
      supplierSchema.parse({ name: 'Acme', contacts: [{ isPrimary: true }, { isPrimary: true }] })
    ).toThrow()
  })
  it('old writes preserve links, conflicting legacy edits fail, explicit clearing works', () => {
    const current = {
      preferredSupplierId: 's',
      supplier: 'old',
      supplierPhone: null,
      supplierEmail: null,
    }
    expect(() => assertLegacySupplierChange(current, {})).not.toThrow()
    expect(() => assertLegacySupplierChange(current, { supplier: 'new' })).toThrow()
    expect(() =>
      assertLegacySupplierChange(current, { supplier: 'new', preferredSupplierId: null })
    ).not.toThrow()
  })
})
