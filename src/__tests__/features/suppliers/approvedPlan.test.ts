import { describe, expect, it } from 'vitest'
import { prepareApprovedSupplierPlan } from '@/features/suppliers/Lib/approvedPlan'
const approval = {
  version: 1,
  source: 'carbook',
  sourceAccountId: 'shop',
  periodStart: '2023-11-02T22:00:00Z',
  reviewDate: '2026-11-03',
  activeOnly: true,
  duplicatePolicy: 'keep_separate',
  approvedSuppliers: [
    { externalId: 'a', name: 'Same' },
    { externalId: 'b', name: 'Same' },
  ],
  excludedSupplierIds: ['own'],
}
const snapshot = () => ({
  version: 1,
  source: 'carbook',
  sourceAccountId: 'shop',
  periodStart: approval.periodStart,
  snapshotAt: '2026-11-03T12:00:00Z',
  coverage: { suppliers: false, goods: false, services: false, returns: false, payments: false },
  suppliers: ['a', 'b', 'own'].map((externalId) => ({
    externalId,
    data: { name: 'Same' },
    isArchived: false,
  })),
  movements: ['a', 'b', 'own'].map((supplierId) => ({
    supplierId,
    externalId: supplierId,
    kind: 'payment',
    date: '2026-10-01T12:00:00Z',
    status: 'posted',
    amount: 100,
  })),
})
describe('Approved supplier preparation', () => {
  it('selects only approved cards, keeping namesakes separate and own cards out', () => {
    const plan = prepareApprovedSupplierPlan(snapshot(), approval, 'org')
    expect(plan.ready).toBe(true)
    expect(plan.sourceCoverageComplete).toBe(false)
    expect(plan.items.map((i) => [i.externalSupplierId, i.action])).toEqual([
      ['a', 'create_separate'],
      ['b', 'create_separate'],
    ])
  })
  it('blocks inactive, renamed and unproven cards despite approval', () => {
    const s = snapshot()
    s.suppliers[0].isArchived = true
    s.suppliers[1].data.name = 'Changed'
    s.movements = s.movements.filter((m) => m.supplierId !== 'b')
    expect(prepareApprovedSupplierPlan(s, approval, 'org').blockers).toHaveLength(3)
  })
  it('rejects missing approved cards and mismatched source accounts', () => {
    const s = snapshot()
    s.suppliers = s.suppliers.slice(1)
    expect(() => prepareApprovedSupplierPlan(s, approval, 'org')).toThrow('missing')
    expect(() =>
      prepareApprovedSupplierPlan(snapshot(), { ...approval, sourceAccountId: 'other' }, 'org')
    ).toThrow('mismatch')
  })
  it('rejects overlapping exclusions and repeated approved IDs', () => {
    expect(() =>
      prepareApprovedSupplierPlan(snapshot(), { ...approval, excludedSupplierIds: ['a'] }, 'org')
    ).toThrow()
    expect(() =>
      prepareApprovedSupplierPlan(
        snapshot(),
        {
          ...approval,
          approvedSuppliers: [approval.approvedSuppliers[0], approval.approvedSuppliers[0]],
        },
        'org'
      )
    ).toThrow()
  })
  it('skips source mappings on repeat and blocks unrelated CRM conflicts', () => {
    const existing = [
      {
        id: 'crm-a',
        name: 'Different',
        taxId: null,
        contacts: [],
        sourceLinks: [{ source: 'carbook', sourceAccountId: 'shop', externalSupplierId: 'a' }],
      },
    ]
    const plan = prepareApprovedSupplierPlan(snapshot(), approval, 'org', existing)
    expect(plan.items[0].action).toBe('skip_existing')
    expect(plan.summary).toEqual({ approved: 2, create: 1, alreadyLinked: 1 })
    const conflict = prepareApprovedSupplierPlan(snapshot(), approval, 'org', [
      ...existing,
      { id: 'other', name: 'Same', taxId: null, contacts: [], sourceLinks: [] },
    ])
    expect(conflict.ready).toBe(false)
  })
  it('binds checksums to reviewed data and approval', () => {
    const first = prepareApprovedSupplierPlan(snapshot(), approval, 'org')
    const s = snapshot()
    s.movements[0].amount = 123
    expect(prepareApprovedSupplierPlan(s, approval, 'org').snapshotChecksum).not.toBe(
      first.snapshotChecksum
    )
    expect(prepareApprovedSupplierPlan(snapshot(), approval, 'org').approvalChecksum).toBe(
      first.approvalChecksum
    )
  })
})
