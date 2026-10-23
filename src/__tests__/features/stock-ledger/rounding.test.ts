// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  calculateLine,
  cents,
  D,
  fifo,
  lineSchema,
  moneyText,
  quantityText,
  proportionalAmount,
} from '@/features/stock-ledger/Lib/amounts'

// Independent integer/rational oracle: no Decimal or floating-point arithmetic.
const scale = BigInt(1_000_000)
function scaled(text: string) {
  const [whole, fraction = ''] = text.split('.')
  return BigInt(whole) * scale + BigInt(fraction.padEnd(6, '0'))
}
function halfUp(n: bigint, d: bigint) {
  return (BigInt(2) * n + d) / (BigInt(2) * d)
}
function oracle(input: ReturnType<typeof lineSchema.parse>) {
  const gross = scaled(input.quantity) * scaled(input.unitPrice)
  const discount =
    input.discountType === 'PERCENT'
      ? { n: gross * scaled(input.discountValue), d: BigInt(100) * scale }
      : {
          n: input.discountType === 'AMOUNT' ? scaled(input.discountValue) * scale : BigInt(0),
          d: BigInt(1),
        }
  const discounted = halfUp(
    (gross * discount.d - discount.n) * BigInt(100),
    scale * scale * discount.d
  )
  const rate = scaled(input.taxRate)
  const tax =
    input.taxMode === 'NONE'
      ? BigInt(0)
      : halfUp(
          discounted * rate,
          input.taxMode === 'INCLUSIVE' ? BigInt(100) * scale + rate : BigInt(100) * scale
        )
  return [
    halfUp(discount.n * BigInt(100), scale * scale * discount.d),
    input.taxMode === 'INCLUSIVE' ? discounted - tax : discounted,
    tax,
    input.taxMode === 'EXCLUSIVE' ? discounted + tax : discounted,
  ]
}
function assertLine(raw: Record<string, unknown>) {
  const input = lineSchema.parse({ inventoryPartId: 'p', quantity: '1', unitPrice: '1', ...raw })
  const result = calculateLine(input)
  const expected = oracle(input)
  const actual = [result.discountAmount, result.netAmount, result.taxAmount, result.totalAmount]
  expect(
    actual.map((v) => BigInt(v.mul(100).toFixed(0))),
    JSON.stringify(input)
  ).toEqual(expected)
  expect(result.netAmount.plus(result.taxAmount).eq(result.totalAmount)).toBe(true)
  for (const value of actual) {
    expect(value.gte(0)).toBe(true)
    expect(value.decimalPlaces()).toBeLessThanOrEqual(2)
  }
}

describe('rounding contract against independent BigInt oracle', () => {
  it.each([
    '0',
    '0.004999',
    '0.005',
    '0.005001',
    '0.014999',
    '0.015',
    '1.005',
    '2.675',
    '99999999999999.995',
  ])('HALF_UP boundary %s', (price) => assertLine({ unitPrice: price }))
  it.each([
    'NONE',
    'INCLUSIVE',
    'EXCLUSIVE',
  ])('tax mode %s with fractional quantities and discounts', (taxMode) => {
    for (const taxRate of taxMode === 'NONE' ? ['0'] : ['0', '7', '20', '99.999', '100'])
      for (const quantity of ['0.001', '0.333', '1', '3', '9999.999'])
        for (const discountValue of ['0', '0.001', '33.333333', '99.999999', '100'])
          assertLine({
            quantity,
            unitPrice: '123.456789',
            taxMode,
            taxRate,
            discountType: 'PERCENT',
            discountValue,
          })
  })
  it('large permitted values retain cents after multiplication and near-100% discount', () => {
    assertLine({
      quantity: '99999999999999.999',
      unitPrice: '99999999999999.999999',
      discountType: 'PERCENT',
      discountValue: '99.999999',
      taxMode: 'EXCLUSIVE',
      taxRate: '20',
    })
  })
  it('2000 deterministic generated fractional-price cases', () => {
    let seed = 0x42c0ffee
    const next = (max: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed % max
    }
    const text = (n: number, digits: number) =>
      `${Math.floor(n / 10 ** digits)}.${String(n % 10 ** digits).padStart(digits, '0')}`
    for (let i = 0; i < 2000; i++) {
      const taxMode = ['NONE', 'INCLUSIVE', 'EXCLUSIVE'][next(3)]
      assertLine({
        quantity: text(next(999999) + 1, 3),
        unitPrice: text(next(99999999), 6),
        discountType: 'PERCENT',
        discountValue: text(next(100000001), 6),
        taxMode,
        taxRate: taxMode === 'NONE' ? '0' : text(next(100001), 3),
      })
    }
  })
  it('fixed discounts are per line, including exact full discount', () => {
    for (const discountValue of ['0', '0.005', '0.999999', '1'])
      assertLine({
        quantity: '2',
        unitPrice: '0.5',
        discountType: 'AMOUNT',
        discountValue,
        taxMode: 'EXCLUSIVE',
        taxRate: '20',
      })
  })
  it('document totals sum rounded lines, not rounded unrounded grand total', () => {
    const line = calculateLine(
      lineSchema.parse({ inventoryPartId: 'p', quantity: '1', unitPrice: '0.005' })
    )
    expect(line.totalAmount.mul(100).toFixed(2)).toBe('1.00')
    expect(cents(D('0.005').mul(100)).toFixed(2)).toBe('0.50')
  })
  it.each([
    '-1',
    'NaN',
    'Infinity',
    '1e3',
    '1,5',
    ' 1',
    '',
    '0.0000001',
  ])('rejects malformed decimal %s', (unitPrice) => {
    expect(() => lineSchema.parse({ inventoryPartId: 'p', quantity: '1', unitPrice })).toThrow()
  })
  it.each([
    '0',
    '-0.01',
    '0.001',
    '1.005',
  ])('rejects invalid money %s instead of silently rounding', (value) =>
    expect(moneyText.safeParse(value).success).toBe(false))
  it.each(['0', '-1', '0.0001', '1.0001'])('rejects invalid quantity %s', (value) =>
    expect(quantityText.safeParse(value).success).toBe(false))
  it.each([
    { discountType: 'PERCENT', discountValue: '100.000001' },
    { discountType: 'AMOUNT', discountValue: '1.000001' },
    { discountValue: '0.01' },
    { taxRate: '20' },
    { taxMode: 'INCLUSIVE', taxRate: '100.001' },
    { taxMode: 'EXCLUSIVE', taxRate: '0.0001' },
  ])('rejects inconsistent business input %j', (input) => expect(() => assertLine(input)).toThrow())
  it('FIFO preserves thousandths, ignores empty lots and does not change source data', () => {
    const lots = [
      { id: 'empty', available: '0', unitCost: '2' },
      { id: 'a', available: '0.001', unitCost: '123.456789' },
      { id: 'b', available: '0.002', unitCost: '2.555555' },
    ]
    const before = JSON.stringify(lots)
    expect(fifo('0.003', lots)).toEqual([
      { lotId: 'a', quantity: '0.001', unitCost: '123.456789', cost: '0.123457' },
      { lotId: 'b', quantity: '0.002', unitCost: '2.555555', cost: '0.005111' },
    ])
    expect(JSON.stringify(lots)).toBe(before)
    expect(() => fifo('0.004', lots)).toThrow()
  })
})

describe('bounded proportional allocation', () => {
  it.each([2, 6])('conserves original amount at %i decimal places for every split', (places) => {
    for (let units = 2; units <= 37; units++) {
      for (const total of ['0', '0.01', '0.02', '1', '12345.67']) {
        let used = D(0)
        for (let i = 0; i < units; i++) {
          const share = proportionalAmount(
            total,
            String(units),
            used.toString(),
            String(i),
            '1',
            places
          )
          expect(share.gte(0)).toBe(true)
          expect(share.decimalPlaces()).toBeLessThanOrEqual(places)
          used = used.plus(share)
          expect(used.lte(total)).toBe(true)
        }
        expect(used.toString()).toBe(D(total).toString())
      }
    }
  })
  it('caps repeated half-cent rounding and assigns final remainder', () => {
    expect(proportionalAmount('0.02', '4', '0.02', '2', '1', 2).toString()).toBe('0')
    expect(proportionalAmount('1', '3', '0.666666', '2', '1', 6).toFixed(6)).toBe('0.333334')
  })
  it.each([
    ['1', '0', '0', '0', '1'],
    ['1', '3', '1.01', '1', '1'],
    ['1', '3', '0', '3', '1'],
    ['1', '3', '0', '0', '0'],
    ['-1', '3', '0', '0', '1'],
    ['1', '3', '0', '-1', '1'],
  ])('rejects invalid allocation %j', (...args) =>
    expect(() => proportionalAmount(args[0], args[1], args[2], args[3], args[4], 6)).toThrow())
  it.each([
    '0',
    '-1',
    '0.0001',
    'NaN',
    'Infinity',
  ])('FIFO rejects invalid requested quantity %s', (q) =>
    expect(() => fifo(q, [{ id: 'a', available: '1', unitCost: '1' }])).toThrow())
})

it('FIFO stops after fulfillment and rejects overprecision in stock', () => {
  expect(
    fifo('1', [
      { id: 'a', available: '2', unitCost: '1' },
      { id: 'b', available: '3', unitCost: '2' },
    ])
  ).toHaveLength(1)
  expect(() => fifo('1', [{ id: 'a', available: '1.0001', unitCost: '1' }])).toThrow()
})
