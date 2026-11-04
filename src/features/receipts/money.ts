// Quantity has three decimal places, price four. Retain all seven places
// until the extended line amount is rounded to the nearest kopeck (half up).
function scaled(value: string, places: number) {
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole + fraction.padEnd(places, '0'))
}

export function lineCents({
  quantity,
  unitPrice,
}: {
  quantity: string
  unitPrice: string
}): bigint | null {
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(quantity) || !/^\d{1,9}(\.\d{1,4})?$/.test(unitPrice))
    return null
  const product = scaled(quantity, 3) * scaled(unitPrice, 4)
  return (product + BigInt(50000)) / BigInt(100000)
}

export function decimalAmount(cents: bigint) {
  return String(cents / BigInt(100)) + '.' + String(cents % BigInt(100)).padStart(2, '0')
}

// Persisted line amounts have already been rounded to two decimal places.
export function receiptTotal(lines: ReadonlyArray<{ amount: { toString(): string } }>) {
  return decimalAmount(
    lines.reduce((sum, line) => sum + scaled(line.amount.toString(), 2), BigInt(0))
  )
}

export function storedLineAmount(line: { quantity: string; unitPrice: string }) {
  const cents = lineCents(line)
  if (cents === null) throw new Error('Перевірте кількість і ціну позиції.')
  if (cents > BigInt('999999999999999999')) throw new Error('Сума позиції перевищує допустиму.')
  return decimalAmount(cents)
}
