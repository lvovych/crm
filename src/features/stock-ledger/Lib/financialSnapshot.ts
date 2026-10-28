import { z } from 'zod'
const decimal = z.string().regex(/^-?\d+(?:\.\d+)?$/)
const nullable = z.string().nullable()
export const financialSnapshotSchema = z.object({
  version: z.literal(2),
  effectiveDate: z.iso.date().optional(),
  partyId: z.string(),
  entryId: z.string().nullable(),
  currency: z.literal('UAH'),
  total: decimal,
  subtotal: decimal,
  taxAmount: decimal,
  taxRate: decimal,
  taxInclusive: z.boolean(),
  discountType: nullable,
  discountValue: decimal,
  discountAmount: decimal,
  customer: z.object({
    id: z.string(),
    name: z.string(),
    email: nullable,
    phone: nullable,
    address: nullable,
    taxId: nullable,
    company: nullable,
    customerNumber: nullable,
  }),
  parts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      partNumber: nullable,
      brand: z.string(),
      unit: nullable,
      quantity: decimal,
      unitPrice: decimal,
      total: decimal,
      discountType: z.string(),
      discountValue: decimal,
    })
  ),
  labor: z.array(
    z.object({
      id: z.string(),
      description: z.string(),
      hours: decimal,
      rate: decimal,
      total: decimal,
      pricingType: z.string(),
    })
  ),
})
export function readFinancialSnapshot(value: unknown) {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 2)
    return null
  const parsed = financialSnapshotSchema.safeParse(value)
  if (!parsed.success)
    throw new Error('Фінансовий знімок пошкоджено. Потрібна перевірка адміністратора.')
  return parsed.data
}
