import { z } from 'zod'
import type { EmployeePayRule, PayPlan } from '@/generated/prisma/client'
import { includesDiscounts } from './rules'

export const commissionLabels = {
  labor: 'Власні виконані роботи',
  partsMargin: 'Заробіток на запчастинах',
  managerLabor: 'Заробіток на роботах менеджера',
  partsSales: 'Продаж запчастин',
  orderMargin: 'Заробіток на всьому наряді',
} as const
export const ruleSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    basis: z.enum(['labor', 'partsMargin', 'managerLabor', 'partsSales', 'orderMargin']),
    scope: z.enum(['performer', 'seller', 'manager', 'workshop']),
    rate: z.coerce.number().positive().max(100).multipleOf(0.01),
    effective: z.string().date(),
    enabled: z.boolean(),
    afterDiscount: z.boolean(),
    deductMechanicPay: z.boolean(),
    deductSubcontractCost: z.boolean(),
    includeNegative: z.boolean(),
  })
  .superRefine((r, ctx) => {
    if (
      (r.basis === 'labor' && r.scope !== 'performer') ||
      (['managerLabor', 'orderMargin'].includes(r.basis) &&
        !['manager', 'workshop'].includes(r.scope)) ||
      (['partsMargin', 'partsSales'].includes(r.basis) && r.scope === 'performer')
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Оберіть відповідний спосіб призначення працівника.',
      })
  })
export type CommissionRule = Omit<z.infer<typeof ruleSchema>, 'rate'> & {
  id: string
  ruleKey: string
  rate: string
  createdAt: string
}
export function serializeRule(r: EmployeePayRule): CommissionRule {
  return {
    ...r,
    basis: r.basis as CommissionRule['basis'],
    scope: r.scope as CommissionRule['scope'],
    rate: r.rate.toFixed(2),
    effective: r.effective.toISOString().slice(0, 10),
    createdAt: r.createdAt.toISOString(),
  }
}
/** Legacy plans remain readable without rewriting historical documents. */
export function legacyRules(plans: PayPlan[]): CommissionRule[] {
  return plans.flatMap((p) =>
    (['labor', 'partsSales', 'partsMargin', 'orderMargin'] as const).map((basis) => ({
      id: `legacy:${p.id}:${basis}`,
      ruleKey: `legacy:${basis}`,
      name: commissionLabels[basis],
      basis,
      scope:
        basis === 'labor'
          ? ('performer' as const)
          : basis === 'orderMargin'
            ? ('manager' as const)
            : ('seller' as const),
      rate: p[basis].gt(0) ? p[basis].toFixed(2) : '1.00',
      enabled: p[basis].gt(0),
      effective: p.effective.toISOString().slice(0, 10),
      createdAt: '1970-01-01T00:00:00.000Z',
      afterDiscount: includesDiscounts(basis, p),
      deductMechanicPay: false,
      deductSubcontractCost: true,
      includeNegative: basis === 'orderMargin' ? p.includeNegativeOrderMargin : true,
    }))
  )
}
export function rulesAt(versions: CommissionRule[], day: string) {
  const chosen = new Map<string, CommissionRule>()
  for (const rule of [...versions].sort(
    (a, b) =>
      a.effective.localeCompare(b.effective) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id)
  )) {
    if (rule.effective <= day) chosen.set(rule.ruleKey, rule)
  }
  return [...chosen.values()].filter((r) => r.enabled)
}
