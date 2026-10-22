import { Prisma } from '@/generated/prisma/browser'
import { z } from 'zod'

export const decimalText = z
  .string()
  .regex(/^\d{1,14}(?:\.\d{1,6})?$/, 'Введіть невід’ємне число через крапку')
export const quantityText = decimalText.refine(
  (v) => new Prisma.Decimal(v).gt(0) && new Prisma.Decimal(v).decimalPlaces() <= 3,
  'Кількість має бути додатною, до 3 знаків після крапки'
)
export const moneyText = decimalText.refine(
  (v) => new Prisma.Decimal(v).gt(0) && new Prisma.Decimal(v).decimalPlaces() <= 2,
  'Сума має бути додатною, до 2 знаків після крапки'
)
export const lineSchema = z.object({
  inventoryPartId: z.string().min(1),
  purchaseOrderLineId: z
    .string()
    .nullish()
    .transform((v) => v ?? undefined)
    .optional(),
  quantity: quantityText,
  unitPrice: decimalText,
  discountType: z.enum(['NONE', 'PERCENT', 'AMOUNT']).default('NONE'),
  discountValue: decimalText.default('0'),
  taxMode: z.enum(['NONE', 'INCLUSIVE', 'EXCLUSIVE']).default('NONE'),
  taxRate: decimalText.default('0'),
})
export type LineInput = z.infer<typeof lineSchema>
export const D = (value: string | number | InstanceType<typeof Prisma.Decimal>) =>
  new Prisma.Decimal(value)
export const cents = (value: InstanceType<typeof Prisma.Decimal>) =>
  value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
export function calculateLine(input: LineInput) {
  const quantity = D(input.quantity),
    price = D(input.unitPrice),
    value = D(input.discountValue),
    rate = D(input.taxRate)
  if (rate.gt(100) || rate.decimalPlaces() > 3) throw new Error('Некоректна ставка податку')
  if (input.discountType === 'PERCENT' && value.gt(100))
    throw new Error('Знижка не може перевищувати 100%')
  if (input.discountType === 'NONE' && !value.isZero())
    throw new Error('Для рядка без знижки сума знижки має бути нульовою')
  if (input.taxMode === 'NONE' && !rate.isZero())
    throw new Error('Для рядка без податку ставка має бути нульовою')
  const gross = quantity.mul(price)
  const discount =
    input.discountType === 'PERCENT'
      ? gross.mul(value).div(100)
      : input.discountType === 'AMOUNT'
        ? value
        : D(0)
  if (discount.gt(gross)) throw new Error('Знижка перевищує вартість рядка')
  const discounted = cents(gross.minus(discount))
  const tax =
    input.taxMode === 'EXCLUSIVE'
      ? cents(discounted.mul(rate).div(100))
      : input.taxMode === 'INCLUSIVE'
        ? cents(discounted.mul(rate).div(D(100).plus(rate)))
        : D(0)
  return {
    discountAmount: cents(discount),
    netAmount: input.taxMode === 'INCLUSIVE' ? discounted.minus(tax) : discounted,
    taxAmount: tax,
    totalAmount: input.taxMode === 'EXCLUSIVE' ? discounted.plus(tax) : discounted,
  }
}
/** FIFO allocation preserves lot costs and never rounds quantities through Number. */
export function fifo(
  quantity: string,
  lots: { id: string; available: string; unitCost: string }[]
) {
  let remaining = D(quantity)
  const allocations: { lotId: string; quantity: string; unitCost: string; cost: string }[] = []
  for (const lot of lots) {
    if (remaining.isZero()) break
    const taken = Prisma.Decimal.min(remaining, D(lot.available))
    if (taken.lte(0)) continue
    allocations.push({
      lotId: lot.id,
      quantity: taken.toFixed(3),
      unitCost: lot.unitCost,
      cost: taken.mul(lot.unitCost).toFixed(6),
    })
    remaining = remaining.minus(taken)
  }
  if (remaining.gt(0)) throw new Error('Недостатньо доступного залишку')
  return allocations
}
