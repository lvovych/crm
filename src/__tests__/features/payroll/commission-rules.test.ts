import { describe, it, expect } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
import { legacyRules, ruleSchema, rulesAt } from '@/features/payroll/commission-rules'
import { rule } from './ui-fixtures'
import { rosterIdentity } from '@/features/employees/roster'
describe('Versioned commission rules', () => {
  it.each([
    ['labor', 'manager'],
    ['labor', 'workshop'],
    ['managerLabor', 'performer'],
    ['orderMargin', 'seller'],
    ['partsMargin', 'performer'],
    ['partsSales', 'performer'],
  ])('rejects incompatible %s / %s', (basis, scope) => {
    expect(ruleSchema.safeParse({ ...rule, basis, scope }).success).toBe(false)
  })
  it.each([0, -1, 100.01, Infinity, NaN, 0.001])('rejects invalid percentage %s', (rate) =>
    expect(ruleSchema.safeParse({ ...rule, rate }).success).toBe(false))
  it('accepts the smallest percentage and independent workshop/manager/seller scopes', () => {
    for (const scope of ['workshop', 'manager', 'seller'])
      expect(ruleSchema.parse({ ...rule, basis: 'partsSales', scope, rate: '0.01' }).rate).toBe(
        0.01
      )
  })
  it('migrates legacy percentage conditions without treating a monthly salary as a commission', () => {
    const d = (value: number) => new Prisma.Decimal(value)
    const converted = legacyRules([
      {
        id: 'old',
        technicianId: 'm',
        frequency: 'weekly',
        effective: new Date('2026-11-01'),
        monthly: d(5000),
        labor: d(40),
        partsSales: d(0),
        partsMargin: d(10),
        orderMargin: d(3),
        afterDiscount: false,
        marginAfterDiscount: true,
        discountsByBasis: { partsMargin: false },
        ruleIds: [],
        includeNegativeOrderMargin: true,
      },
    ])
    expect(converted).toHaveLength(4)
    expect(converted.find((r) => r.basis === 'partsSales')).toMatchObject({
      enabled: false,
      scope: 'seller',
    })
    expect(converted.find((r) => r.basis === 'orderMargin')).toMatchObject({
      scope: 'manager',
      includeNegative: true,
    })
    expect(converted.find((r) => r.basis === 'partsMargin')?.afterDiscount).toBe(false)
    expect(rulesAt(converted, '2026-11-02')).toHaveLength(3)
  })
  it('uses effective date first and deterministic revision ordering for same-date revisions', () => {
    const versions = [
      { ...rule, id: 'a', rate: '10' },
      { ...rule, id: 'b', rate: '20' },
      { ...rule, id: 'older', effective: '2026-10-01', createdAt: '2026-12-01', rate: '30' },
      { ...rule, id: 'newest', createdAt: '2026-11-02', rate: '50' },
    ]
    expect(rulesAt(versions, '2026-11-10')[0].rate).toBe('50')
    expect(rulesAt(versions, '2026-10-10')[0].rate).toBe('30')
  })
  it('maps an owner account and retains explicit payroll roles or unlinked identities', () => {
    const person = {
      name: 'Old',
      workRoles: ['mechanic'],
      organizationId: 'org',
      user: {
        name: 'Owner',
        organizationMembers: [{ organizationId: 'org', role: 'owner', customRole: null }],
      },
    }
    expect(rosterIdentity(person)).toMatchObject({
      name: 'Owner',
      workRoles: ['owner'],
      crmRole: 'Власник',
    })
    expect(rosterIdentity({ ...person, workRoles: [] }).workRoles).toEqual([])
    expect(rosterIdentity({ ...person, user: null })).toMatchObject({
      name: 'Old',
      workRoles: ['mechanic'],
      crmRole: null,
    })
  })
})
