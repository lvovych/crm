/** Exact decimal boundaries. Quantities and prices have their own scales;
 * ledger amounts are cents. Legacy number rounding stays in lib/money. */
export function parseFixed(
  value: string,
  scale = 2,
  options: { signed?: boolean; wholeDigits?: number } = {}
): bigint {
  const { signed = true, wholeDigits = 20 } = options
  if (
    !Number.isInteger(scale) ||
    scale < 0 ||
    scale > 7 ||
    !Number.isInteger(wholeDigits) ||
    wholeDigits < 1 ||
    wholeDigits > 30
  )
    throw new Error('Invalid decimal scale')
  const pattern = new RegExp(
    `^${signed ? '-?' : ''}\\d{1,${wholeDigits}}${scale ? `(\\.\\d{1,${scale}})?` : ''}$`
  )
  if (!pattern.test(value)) throw new Error('Invalid decimal amount')
  const negative = value.startsWith('-')
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.')
  const n = BigInt(whole) * BigInt(10) ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0') || '0')
  return negative ? -n : n
}
export function formatFixed(value: bigint, scale = 2): string {
  if (!Number.isInteger(scale) || scale < 0 || scale > 7) throw new Error('Invalid decimal scale')
  const n = value < BigInt(0) ? -value : value
  const divisor = BigInt(10) ** BigInt(scale)
  return `${value < BigInt(0) ? '-' : ''}${n / divisor}${scale ? '.' + String(n % divisor).padStart(scale, '0') : ''}`
}
/** Half away from zero, including credits that reverse positive charges. */
export function roundScaled(value: bigint, divisor: bigint): bigint {
  if (divisor <= BigInt(0)) throw new Error('Invalid rounding divisor')
  const n = value < BigInt(0) ? -value : value
  const rounded = (n * BigInt(2) + divisor) / (divisor * BigInt(2))
  return value < BigInt(0) ? -rounded : rounded
}
