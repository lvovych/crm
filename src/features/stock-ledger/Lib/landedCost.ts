import { D, cents } from './amounts'
/** Largest remainder in integer kopecks; stable row order resolves equal fractions. */
export function distributeCost(total: string, bases: string[], manual?: string[]) {
  const amount = D(total)
  if (amount.lt(0) || amount.decimalPlaces() > 2)
    throw new Error('Додаткові витрати: невід’ємна сума до копійок')
  if (manual) {
    if (
      manual.length !== bases.length ||
      manual.some((v) => D(v).lt(0) || D(v).decimalPlaces() > 2) ||
      !manual.reduce((s, v) => s.plus(v), D(0)).eq(amount)
    )
      throw new Error('Ручний розподіл має точно дорівнювати додатковим витратам')
    return manual.map((v) => D(v))
  }
  if (amount.isZero()) return bases.map(() => D(0))
  const base = bases.reduce((s, v) => s.plus(v), D(0))
  if (base.lte(0)) throw new Error('Нульова база: вкажіть ручний розподіл додаткових витрат')
  const quotas = bases.map((v) => amount.mul(100).mul(v).div(base)),
    parts = quotas.map((v) => v.floor())
  const order = quotas
    .map((v, i) => ({ i, remainder: v.minus(parts[i]) }))
    .sort((a, b) => b.remainder.comparedTo(a.remainder) || a.i - b.i)
  let left = amount.mul(100).minus(parts.reduce((s, v) => s.plus(v), D(0)))
  for (const row of order) {
    if (left.isZero()) break
    parts[row.i] = parts[row.i].plus(1)
    left = left.minus(1)
  }
  return parts.map((v) => v.div(100))
}
export function receiptTotal(
  lines: { totalAmount: ReturnType<typeof D> }[],
  extra: string,
  rounding: string,
  reason: string,
  source?: string
) {
  const adjustment = D(rounding)
  if (
    adjustment.abs().gt('0.01') ||
    adjustment.decimalPlaces() > 2 ||
    (!adjustment.isZero() && reason.trim().length < 5)
  )
    throw new Error('Коригування округлення: до ±0,01 грн з поясненням')
  const total = cents(
    lines
      .reduce((s, l) => s.plus(l.totalAmount), D(0))
      .plus(extra)
      .plus(adjustment)
  )
  if (total.lt(0)) throw new Error('Сума документа не може бути від’ємною')
  if (source !== undefined && !D(source).eq(total))
    throw new Error(`Підсумок накладної не збігається: розраховано ${total.toFixed(2)} грн`)
  return total
}
