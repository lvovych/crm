// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { resolveBrandSnapshot } from '@/features/inventory/Lib/brandSnapshot'
import { servicePartSchema } from '@/features/vehicles/Schema/serviceSchema'
import { quotePartSchema } from '@/features/quotes/Schema/quoteSchema'
import { laborPresetPartSchema } from '@/features/labor-presets/Schema/laborPresetSchema'
import {
  createInventoryPartSchema,
  updateInventoryPartSchema,
} from '@/features/inventory/Schema/inventorySchema'

describe('brand snapshots survive document editing', () => {
  const old = {
    name: 'Filter',
    partNumber: '123',
    inventoryPartId: 'stock1',
    brand: 'Historical brand',
  }
  it('preserves the historical name even when the directory is renamed', () => {
    expect(resolveBrandSnapshot({ ...old, brand: undefined }, [old], 'Renamed')).toBe(old.brand)
  })
  it('snapshots inventory for new lines and defaults unknown manual parts', () => {
    expect(resolveBrandSnapshot({ name: 'New' }, [], 'Bosch')).toBe('Bosch')
    expect(resolveBrandSnapshot({ name: 'New' })).toBe('---')
  })
  it('honors an explicit change including the universal brand', () => {
    expect(resolveBrandSnapshot({ ...old, brand: '---' }, [old], 'Bosch')).toBe('---')
  })
  it('does not guess between identical parts from different manufacturers', () => {
    expect(() =>
      resolveBrandSnapshot({ ...old, brand: undefined }, [old, { ...old, brand: 'Other' }])
    ).toThrow('Ambiguous')
  })
  it.each([
    servicePartSchema,
    quotePartSchema,
    laborPresetPartSchema,
  ])('retains brands through line validation', (schema) => {
    expect(schema.parse({ name: 'Filter', brand: 'Aral' }).brand).toBe('Aral')
    expect(schema.parse({ name: 'Filter' }).brand).toBeUndefined()
    expect(() => schema.parse({ name: 'Filter', brand: ' ' })).toThrow()
  })
  it('does not reset brand on unrelated inventory patches', () => {
    expect(updateInventoryPartSchema.parse({ id: 'p1', quantity: 2 }).brandId).toBeUndefined()
    expect(
      createInventoryPartSchema.parse({ name: 'Filter', brandId: 'brand_unknown' }).brandId
    ).toBe('brand_unknown')
  })
})
