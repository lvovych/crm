import { decimalAmount, lineCents } from './money'
import { quantityUnits } from './transfer-schema'
import { parseFixed } from '@/lib/exact-money'
const cents = (value: string) => parseFixed(value, 2, { signed: false })
export function returnLineAmount(
  line: {
    originalQuantity: string
    originalAmount: string
    returnedQuantity: string
    returnedAmount: string
    unitPrice: string
  },
  quantity: string
) {
  const cumulative = quantityUnits(line.returnedQuantity) + quantityUnits(quantity)
  const full = quantityUnits(line.originalQuantity)
  if (cumulative > full) throw new Error('Кількість перевищує отриману.')
  const amount =
    cumulative === full
      ? cents(line.originalAmount)
      : lineCents({
          quantity: `${cumulative / BigInt(1000)}.${String(cumulative % BigInt(1000)).padStart(3, '0')}`,
          unitPrice: line.unitPrice,
        })
  if (amount === null) throw new Error('Перевірте кількість і ціну.')
  const result = amount - cents(line.returnedAmount)
  if (result < BigInt(0)) throw new Error('Некоректна сума попередніх повернень.')
  return decimalAmount(result)
}
