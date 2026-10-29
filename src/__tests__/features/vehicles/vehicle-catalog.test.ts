import { describe, expect, it } from 'vitest'
import { createVehicleSchema } from '@/features/vehicles/Schema/vehicleSchema'
import { catalogSearch, REGISTRATION_COLORS } from '@/features/vehicles/Lib/vehicleCatalog'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import index from '../../../../public/vehicle-catalog/index.json'

// Imported snapshot must remain usable even after future data refreshes.
describe('offline vehicle catalogue', () => {
  it('finds names without requiring diacritics', () => {
    expect(catalogSearch('Škoda')).toBe('skoda')
    expect(catalogSearch(' CITROËN ')).toBe('citroen')
  })
  it('has a readable, unambiguous model/generation/engine tree for every advertised make', () => {
    expect(index.length).toBeGreaterThan(150)
    expect(new Set(index.map((m) => m.id)).size).toBe(index.length)
    for (const make of index) {
      expect(make.id).toMatch(/^[a-z0-9-]+$/)
      const data = JSON.parse(
        readFileSync(join(process.cwd(), 'public/vehicle-catalog', `${make.id}.json`), 'utf8')
      )
      expect(data.name).toBe(make.name)
      for (const model of data.models) {
        expect(model.name).not.toBe('')
        expect(new Set(model.generations.map((g: { name: string }) => g.name)).size).toBe(
          model.generations.length
        )
        for (const gen of model.generations) {
          expect(new Set(gen.engines.map((e: { name: string }) => e.name)).size).toBe(
            gen.engines.length
          )
        }
      }
    }
  })
  it('keeps the 11 MVS colour choices and permits old vehicles without optional catalogue details', () => {
    expect(REGISTRATION_COLORS).toHaveLength(11)
    expect(new Set(REGISTRATION_COLORS).size).toBe(11)
    expect(
      createVehicleSchema.parse({ make: 'Historic manufacturer', model: 'Unknown', year: 1950 })
        .generation
    ).toBeUndefined()
    expect(
      createVehicleSchema.parse({
        make: 'Toyota',
        model: 'Corolla',
        year: 2020,
        generation: 'Corolla (2019)',
        modification: '1.8 Hybrid',
        vin: 'JT123456789012345',
        color: 'Gray',
      })
    ).toMatchObject({
      generation: 'Corolla (2019)',
      modification: '1.8 Hybrid',
      vin: 'JT123456789012345',
      color: 'Gray',
    })
  })
})
