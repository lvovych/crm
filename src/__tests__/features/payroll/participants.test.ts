import { describe, expect, it } from 'vitest'
import { resolveExecutor } from '@/features/payroll/participants'
import { rosterIdentity } from '@/features/employees/roster'
const people = [
  { id: 'a', name: 'Mechanic A' },
  { id: 'b', name: 'Mechanic B' },
]
const labor = { technicianId: null, subcontract: null }
describe('Existing payroll participants', () => {
  it('uses the explicitly selected line mechanic before the order mechanic', () => {
    expect(
      resolveExecutor({ ...labor, technicianId: 'b' }, { technicianId: 'a' }, people).technicianId
    ).toBe('b')
  })
  it('resolves frozen inherited executor even after the order mechanic changes', () => {
    const result = resolveExecutor(
      { ...labor, executorFrozen: true, executorName: 'Mechanic A' },
      { technicianId: 'b' },
      people
    )
    expect(result.technicianId).toBe('a')
    expect(result.assignmentSource).toContain('закритті')
  })
  it('inherits the order mechanic for lines without a frozen assignment', () => {
    expect(resolveExecutor(labor, { technicianId: 'a' }, people).technicianId).toBe('a')
  })
  it('does not replace missing or ambiguous frozen evidence with the header', () => {
    for (const executorName of [null, 'Missing', 'Mechanic A']) {
      const result = resolveExecutor(
        { ...labor, executorFrozen: true, executorName },
        { technicianId: 'b' },
        [...people, { id: 'duplicate', name: 'Mechanic A' }]
      )
      expect(result.technicianId).toBeNull()
      expect(result.assignmentIssue).toBeTruthy()
    }
  })
  it('never pays a mechanic for subcontract work or a shop fee', () => {
    for (const extra of [{ subcontract: {} }, { pricingType: 'shopFee' }]) {
      expect(
        resolveExecutor({ ...labor, technicianId: 'a', ...extra }, { technicianId: 'a' }, people)
          .technicianId
      ).toBeNull()
    }
  })
  it('rejects an explicit executor outside the supplied organization roster', () => {
    expect(
      resolveExecutor({ ...labor, technicianId: 'foreign' }, { technicianId: 'a' }, people)
        .assignmentIssue
    ).toBeTruthy()
  })
  it('shows the linked CRM manager rather than the old default mechanic label', () => {
    const person = {
      name: 'Old display',
      organizationId: 'org',
      workRoles: ['mechanic'],
      user: {
        name: 'Manager',
        organizationMembers: [
          { organizationId: 'org', role: 'member', customRole: { name: 'Менеджер' } },
        ],
      },
    }
    expect(rosterIdentity(person)).toEqual({
      name: 'Manager',
      workRoles: ['advisor'],
      crmRole: 'Менеджер',
    })
    expect(rosterIdentity({ ...person, workRoles: ['advisor', 'mechanic'] }).workRoles).toEqual([
      'advisor',
      'mechanic',
    ])
    expect(rosterIdentity({ ...person, organizationId: 'other' }).workRoles).toEqual(['mechanic'])
  })
})
