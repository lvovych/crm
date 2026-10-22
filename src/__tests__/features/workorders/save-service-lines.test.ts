import { describe, it, expect, vi } from 'vitest'
import { prepareParts, prepareLabor } from '@/features/vehicles/Lib/saveServiceLines'
const part = {
  id: 'p1',
  name: 'Oil',
  quantity: 2,
  unitPrice: 100,
  total: 197,
  unitCost: 80,
  markupPercent: 25,
  discountType: 'none' as const,
  discountValue: 0,
}
const labor = {
  id: 'l1',
  description: 'Repair',
  hours: 1,
  rate: 100,
  total: 100,
  pricingType: 'hourly' as const,
  technicianId: 'a',
  executorName: 'Mechanic A',
  executorFrozen: true,
  executorLegacy: false,
}
function tx(
  parts: unknown[] = [part],
  labors: unknown[] = [labor],
  techs: unknown[] = [{ id: 'a', name: 'Mechanic A', isActive: true }]
) {
  return {
    servicePart: { findMany: vi.fn().mockResolvedValue(parts) },
    serviceLabor: { findMany: vi.fn().mockResolvedValue(labors) },
    technician: { findMany: vi.fn().mockResolvedValue(techs) },
  } as any
}
describe('saving work order lines', () => {
  it('preserves imported total and stable ID on metadata edit', async () => {
    const [saved] = await prepareParts(tx(), 'job', [{ ...part, name: 'New name' }])
    expect(saved.total).toBe(197)
    expect(saved.id).toBe('p1')
  })
  it('recomputes edited price on server, ignoring forged client total', async () => {
    const [saved] = await prepareParts(tx(), 'job', [
      { ...part, discountType: 'percentage', discountValue: 10, total: 1 },
    ])
    expect(saved.total).toBe(180)
  })
  it('rejects an ID outside the order', async () => {
    await expect(prepareParts(tx(), 'job', [{ ...part, id: 'foreign' }])).rejects.toThrow()
  })
  it('keeps frozen executor on unrelated edits and ignores forged snapshot', async () => {
    const [saved] = await prepareLabor(tx(), 'org', 'job', [
      { ...labor, description: 'Changed', executorName: 'Forged' },
    ])
    expect(saved.executorName).toBe('Mechanic A')
    expect(saved.executorFrozen).toBe(true)
  })
  it('allows an inherited executor without fabricating a name', async () => {
    const [saved] = await prepareLabor(tx([], [], []), 'org', null, [
      { description: 'Work', hours: 1, rate: 1, total: 1, pricingType: 'hourly' },
    ])
    expect(saved.technicianId).toBeNull()
    expect(saved.executorName).toBeNull()
    expect(saved.executorFrozen).toBe(false)
  })
  it('rejects foreign technician and newly assigned inactive technician', async () => {
    await expect(prepareLabor(tx([], [], []), 'org', null, [labor])).rejects.toThrow()
    await expect(
      prepareLabor(tx([], [], [{ id: 'a', name: 'A', isActive: false }]), 'org', null, [
        { ...labor, id: undefined },
      ])
    ).rejects.toThrow()
  })
  it('retains existing inactive executor', async () => {
    const [saved] = await prepareLabor(
      tx([], [labor], [{ id: 'a', name: 'A', isActive: false }]),
      'org',
      'job',
      [labor]
    )
    expect(saved.technicianId).toBe('a')
  })
  it('explicitly reverting to inheritance clears individual snapshot', async () => {
    const [saved] = await prepareLabor(tx(), 'org', 'job', [{ ...labor, technicianId: null }])
    expect(saved.technicianId).toBeNull()
    expect(saved.executorFrozen).toBe(false)
  })
})
