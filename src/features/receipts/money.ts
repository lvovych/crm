import { parseFixed, formatFixed, roundScaled } from '@/lib/exact-money'

export function lineCents({
  quantity,
  unitPrice,
}: {
  quantity: string
  unitPrice: string
}): bigint | null {
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(quantity) || !/^\d{1,9}(\.\d{1,4})?$/.test(unitPrice))
    return null
  const product =
    parseFixed(quantity, 3, { signed: false, wholeDigits: 9 }) *
    parseFixed(unitPrice, 4, { signed: false, wholeDigits: 9 })
  return roundScaled(product, BigInt(100000))
}

export function decimalAmount(value: bigint) {
  return formatFixed(value)
}

// Persisted line amounts have already been rounded to two decimal places.
export function receiptTotal(lines: ReadonlyArray<{ amount: { toString(): string } }>) {
  return decimalAmount(
    lines.reduce(
      (sum, line) => sum + parseFixed(line.amount.toString(), 2, { signed: false }),
      BigInt(0)
    )
  )
}

export function storedLineAmount(line: { quantity: string; unitPrice: string }) {
  const cents = lineCents(line)
  if (cents === null) throw new Error('Перевірте кількість і ціну позиції.')
  if (cents > BigInt('999999999999999999')) throw new Error('Сума позиції перевищує допустиму.')
  return decimalAmount(cents)
}
