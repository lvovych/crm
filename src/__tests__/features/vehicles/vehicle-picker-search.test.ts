import { describe, expect, it } from 'vitest'
import {
  matchesVehiclePickerSearch as matches,
  vehiclePickerMatchFields,
  type VehiclePickerOption,
} from '@/features/vehicles/Lib/vehiclePickerSearch'

const car: VehiclePickerOption = {
  id: 'golf',
  make: 'Volkswagen',
  model: 'Golf',
  year: 2015,
  licensePlate: 'АС 1234 ВК',
  vin: 'WVWZZZ1KZFW123456',
  customer: { id: 'owner', name: 'Воляник Андрій', company: null, phone: '+380 (67) 987-65-43' },
}

describe('vehicle picker search', () => {
  it.each([
    '',
    ' ',
    '\t\n',
    'Golf',
    'gOlF',
    'Volks',
    '2015',
    'Volkswagen Golf',
    'Golf Volkswagen 2015',
    '  Golf   2015  ',
    'Андрій',
    'Воляник',
    'волян',
    'Воляник Андрій',
    'Андрій Воляник',
    'АНДРІЙ ВОЛЯНИК',
    'Андрій\tВоляник',
    'Golf Воляник',
    'Андрій 1234',
    'Воляник Golf 2015',
    'АС1234ВК',
    'AC1234BK',
    'ac-1234-bk',
    'АС 1234 ВК',
    'AС1234BК',
    '1234',
    'WVWZZZ1KZFW123456',
    'wvwzzz1kzfw123456',
    'WVW-ZZZ1KZ-FW123456',
    'WVW ZZZ1KZ FW123456',
    'FW123456',
    'Воляник FW123456',
    '+380679876543',
    '380679876543',
    '0679876543',
    '+380 (67) 987-65-43',
    '067 987 65 43',
    '067-987-65-43',
    '  +380\u00a0(67)\u00a0987–65–43 ',
    '6543',
    '76543',
    '9876543',
    'Golf 067 987 65 43',
    '6543 Воляник',
    'Андрій +380 (67) 987-65-43 Golf',
  ])('matches %j', (query) => expect(matches(car, query)).toBe(true))

  it.each([
    'Audi',
    '2016',
    'Golf Петро',
    'Воляник Passat',
    'Андрій 9999',
    'ВоляникАндрій',
    'Воляник missing',
    'Golf 2015 nope',
    'АС9999ВК',
    'WVWZZZ1KZFW999999',
    '+380509876543',
    '0509876543',
    '0679876544',
    '543',
    '43',
    '9876',
    '067',
    '+49 0679876543',
    '3800679876543',
    '06798765436543',
    '.*',
    '%',
    '_',
    "' OR 1=1",
    '+',
    '---',
    '()',
  ])('rejects %j', (query) => expect(matches(car, query)).toBe(false))

  it.each([
    '+380679876543',
    '0679876543',
    '067 987 65 43',
    '+380 (67) 987-65-43',
  ])('matches both Ukrainian formats stored as %s', (phone) => {
    const vehicle = { ...car, customer: { ...car.customer!, phone } }
    for (const query of ['0679876543', '+380679876543', '+380 (67) 987-65-43', '6543']) {
      expect(matches(vehicle, query), query).toBe(true)
    }
  })

  it('preserves international numbers without guessing their country code', () => {
    const vehicle = { ...car, customer: { ...car.customer!, phone: '+49 (30) 987-6543' } }
    expect(matches(vehicle, '+49 30 9876543')).toBe(true)
    expect(matches(vehicle, '6543')).toBe(true)
    expect(matches(vehicle, '+380309876543')).toBe(false)
  })

  it.each([
    null,
    { id: 'o', name: 'No phone', company: null },
    { id: 'o', name: 'No phone', company: null, phone: null },
    { id: 'o', name: '', company: null, phone: '' },
  ])('handles missing contact data %j', (customer) => {
    const vehicle = { ...car, vin: null, licensePlate: null, customer }
    expect(matches(vehicle, 'Golf')).toBe(true)
    expect(matches(vehicle, '6543')).toBe(false)
    expect(matches(vehicle, 'Андрій')).toBe(false)
    expect(matches(vehicle, 'WVW')).toBe(false)
  })

  it('normalizes apostrophes and Unicode without transliterating people', () => {
    const vehicle = { ...car, customer: { ...car.customer!, name: 'Лук’ян ПЕТРЕНКО' } }
    expect(matches(vehicle, "Петренко Лук'ян")).toBe(true)
    expect(matches(vehicle, 'Лукʼян')).toBe(true)
    expect(matches(vehicle, 'Lukyan')).toBe(false)
    expect(matches(car, 'Ｇｏｌｆ')).toBe(true)
  })

  it.each(
    Object.entries({
      А: 'A',
      В: 'B',
      Е: 'E',
      І: 'I',
      К: 'K',
      М: 'M',
      Н: 'H',
      О: 'O',
      Р: 'P',
      С: 'C',
      Т: 'T',
      Х: 'X',
    })
  )('equates plate letters %s/%s in both directions', (uk, latin) => {
    expect(
      matches(
        { ...car, licensePlate: `${uk}${uk}9999${uk}${uk}` },
        `${latin}${latin}9999${latin}${latin}`
      )
    ).toBe(true)
    expect(
      matches(
        { ...car, licensePlate: `${latin}${latin}9999${latin}${latin}` },
        `${uk}${uk}9999${uk}${uk}`
      )
    ).toBe(true)
  })

  it('does not apply plate transliteration to VIN or names', () => {
    expect(matches({ ...car, licensePlate: null, vin: 'AA9999', customer: null }, 'АА9999')).toBe(
      false
    )
    expect(
      matches(
        { ...car, licensePlate: null, vin: null, customer: { ...car.customer!, name: 'АННА' } },
        'AHHA'
      )
    ).toBe(false)
  })

  it('returns every car of the owner, without mixing fields between cars or changing order', () => {
    const cars = [
      car,
      { ...car, id: 'passat', model: 'Passat' },
      { ...car, id: 'other', customer: { ...car.customer!, name: 'Петро', phone: '0501112233' } },
    ]
    expect(cars.filter((v) => matches(v, '6543')).map((v) => v.id)).toEqual(['golf', 'passat'])
    expect(cars.filter((v) => matches(v, 'Петро Passat'))).toEqual([])
    expect(cars.filter((v) => matches(v, 'Воляник Passat')).map((v) => v.id)).toEqual(['passat'])
  })

  it('handles long pasted queries without recursive backtracking or mutating data', () => {
    const before = JSON.stringify(car)
    expect(matches(car, '67 '.repeat(300))).toBe(false)
    expect(matches(car, 'Golf '.repeat(300))).toBe(true)
    expect(JSON.stringify(car)).toBe(before)
  })
})

describe('vehicle picker match explanations', () => {
  it.each([
    ['Golf', 'vehicle'],
    ['2015', 'year'],
    ['AC-1234-BK', 'plate'],
    ['андРІЙ', 'owner'],
    ['fw123456', 'vin'],
    ['+380 (67) 987-65-43', 'phone'],
    ['2015 6543', 'phone'],
    ['Воляник 0679876543 Golf', 'phone'],
  ])('highlights %s in %s', (query, field) => {
    expect(
      vehiclePickerMatchFields(car, query)[
        field as keyof ReturnType<typeof vehiclePickerMatchFields>
      ]
    ).toBe(true)
  })
  it.each([
    '',
    ' ',
    '---',
    '543',
    'unknown',
    '99 '.repeat(20),
  ])('does not highlight unrelated data for %j', (query) => {
    expect(Object.values(vehiclePickerMatchFields(car, query))).not.toContain(true)
  })
  it('marks separate fields for a combined query', () => {
    expect(vehiclePickerMatchFields(car, 'Golf Андрій 6543')).toEqual({
      vehicle: true,
      year: false,
      plate: false,
      owner: true,
      vin: false,
      phone: true,
    })
  })
  it('does not show VIN or phone highlights when data is missing', () => {
    expect(
      Object.values(
        vehiclePickerMatchFields(
          { ...car, vin: null, licensePlate: null, customer: null },
          'Андрій 6543 FW123456'
        )
      )
    ).not.toContain(true)
  })
})
