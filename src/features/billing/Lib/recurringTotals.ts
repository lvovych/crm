import { documentTotals } from '@/features/settings/Lib/workshopTax'
import { roundMoney } from '@/lib/money'

type Template = {
  cost: number
  taxRate: number
  taxInclusive: boolean
  taxComponents: unknown
  templateParts: { name: string; partNumber: string | null; quantity: number; unitPrice: number }[]
  templateLabor: { description: string; hours: number; rate: number; pricingType?: string }[]
}
/** Build persisted lines first: the subtotal is the sum the customer can actually see. */
export function recurringTotals(template: Template) {
  const parts = template.templateParts.map((p) => ({
    ...p,
    total: roundMoney(p.quantity * p.unitPrice),
  }))
  const labor = template.templateLabor.map((l) => ({
    ...l,
    pricingType: l.pricingType || 'hourly',
    total: roundMoney(l.hours * l.rate),
  }))
  const cost = roundMoney(template.cost)
  const subtotal = roundMoney(
    cost + parts.reduce((s, p) => s + p.total, 0) + labor.reduce((s, l) => s + l.total, 0)
  )
  return {
    cost,
    subtotal,
    parts,
    labor,
    ...documentTotals({ ...template, subtotal, discountAmount: 0 }),
  }
}
