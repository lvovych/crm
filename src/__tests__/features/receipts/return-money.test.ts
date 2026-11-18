import { describe, expect, it } from 'vitest'
import { returnLineAmount } from '@/features/receipts/return-money'
import { lineCents, decimalAmount } from '@/features/receipts/money'

describe('partial supplier return rounding', () => {
  it.each([
    '0',
    '0.005',
    '0.3333',
    '12.3456',
    '9999.9999',
  ])('conserves the original total across 1000 partial returns at price %s', (unitPrice) => {
    const originalAmount = decimalAmount(lineCents({ quantity: '1', unitPrice })!)
    let returnedCents = BigInt(0)
    for (let i = 0; i < 1000; i++) {
      const amount = returnLineAmount(
        {
          originalQuantity: '1',
          originalAmount,
          returnedQuantity: (i / 1000).toFixed(3),
          returnedAmount: decimalAmount(returnedCents),
          unitPrice,
        },
        '0.001'
      )
      expect(Number(amount)).toBeGreaterThanOrEqual(0)
      returnedCents += BigInt(amount.replace('.', ''))
    }
    expect(decimalAmount(returnedCents)).toBe(originalAmount)
  })

  it('rejects over-return and inconsistent historical amounts', () => {
    const line = {
      originalQuantity: '1',
      originalAmount: '10.00',
      returnedQuantity: '0.9',
      returnedAmount: '9.00',
      unitPrice: '10',
    }
    expect(() => returnLineAmount(line, '0.101')).toThrow('перевищує')
    expect(() => returnLineAmount({ ...line, returnedAmount: '11.00' }, '0.1')).toThrow(
      'попередніх'
    )
  })
})

it('rejects an invalid original price for a partial return', () => {
  expect(() =>
    returnLineAmount(
      {
        originalQuantity: '1',
        originalAmount: '10.00',
        returnedQuantity: '0',
        returnedAmount: '0',
        unitPrice: 'invalid',
      },
      '0.5'
    )
  ).toThrow('кількість і ціну')
})
