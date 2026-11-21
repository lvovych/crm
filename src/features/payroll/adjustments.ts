import { z } from 'zod'
import { cents, decimal, positiveMoney } from '@/features/finance/money'
import type { CommissionDetails } from './commission-calculator'

export const adjustmentSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['bonus', 'deduction']),
  amount: positiveMoney.refine((v) => cents(v) <= BigInt(99999999999), 'Сума завелика.'),
  reason: z.string().trim().min(1, 'Вкажіть пояснення.').max(500),
})
export const adjustmentsSchema = z
  .array(adjustmentSchema)
  .max(100)
  .refine(
    (rows) => new Set(rows.map((r) => r.id)).size === rows.length,
    'Рядки премій та утримань не можуть повторюватися.'
  )
export type SalaryAdjustment = z.infer<typeof adjustmentSchema>

export function snapshotAdjustments(details: unknown): SalaryAdjustment[] {
  if (!details || typeof details !== 'object' || !('adjustments' in details)) return []
  return adjustmentsSchema.parse(details.adjustments)
}

export function withAdjustments(
  details: CommissionDetails,
  rows: SalaryAdjustment[]
): CommissionDetails {
  const adjustments = adjustmentsSchema.parse(rows)
  const total =
    details.lines.reduce((sum, line) => sum + cents(line.amount), BigInt(0)) +
    adjustments.reduce(
      (sum, row) => sum + (row.type === 'bonus' ? BigInt(1) : -BigInt(1)) * cents(row.amount),
      BigInt(0)
    )
  const { adjustments: _previous, ...base } = details
  // Preserve fingerprints of existing v2 documents without adjustments.
  return { ...base, total: decimal(total), ...(adjustments.length ? { adjustments } : {}) }
}
