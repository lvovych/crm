import { roundMoney } from '@/lib/money'

type DiscountLine = {
  quantity: number
  unitPrice: number
  discountType?: string
  discountValue?: number
}
export function discountedPartTotal(line: DiscountLine) {
  const gross = roundMoney(Number(line.quantity) * Number(line.unitPrice))
  const value = Number(line.discountValue ?? 0)
  const type = line.discountType ?? 'none'
  if (
    ![gross, value].every(Number.isFinite) ||
    gross < 0 ||
    value < 0 ||
    !['none', 'percentage', 'fixed'].includes(type) ||
    (type === 'percentage' && value > 100) ||
    (type === 'fixed' && value > gross)
  ) {
    throw new Error('Invalid line discount')
  }
  const discount =
    type === 'percentage'
      ? roundMoney((gross * value) / 100)
      : type === 'fixed'
        ? roundMoney(value)
        : 0
  return roundMoney(gross - discount)
}

/** Metadata-only edits retain imported amounts, including historical rounding differences. */
export function partPriceChanged(next: DiscountLine, previous: DiscountLine) {
  return (
    Number(next.quantity) !== Number(previous.quantity) ||
    Number(next.unitPrice) !== Number(previous.unitPrice) ||
    (next.discountType ?? 'none') !== (previous.discountType ?? 'none') ||
    Number(next.discountValue ?? 0) !== Number(previous.discountValue ?? 0)
  )
}
