import type { SalaryAdjustment } from './adjustments'
import { Prisma } from '@/generated/prisma/client'
import { zonedDayKey } from '@/lib/timezone'
import { rulesAt, type CommissionRule } from './commission-rules'
import type { ExecutorResolution } from './participants'
import type { PayrollOrder, SlipLine } from './calculator'

const D = Prisma.Decimal
export type CommissionOrder = PayrollOrder & {
  status: string
  vehicleId?: string | null
  laborItems: (PayrollOrder['laborItems'][number] & {
    id: string
    pricingType?: string
  } & Partial<ExecutorResolution>)[]
  partItems: (PayrollOrder['partItems'][number] & { id: string })[]
}
export type CommissionLine = SlipLine & {
  orderId: string
  lineId: string
  vehicleId: string | null
  closedAt: string
  kind: 'labor' | 'parts'
  sale: string
  cost: string
  ruleName: string
  effective: string
  executorLabel?: string | null
  assignmentSource?: string | null
}
export type CommissionDetails = {
  version: 2
  adjustments?: SalaryAdjustment[]
  lines: CommissionLine[]
  conditions: string[]
  total: string
  warnings?: string[]
}

export function calculateCommissions(input: {
  orders: CommissionOrder[]
  employee: string
  start: string
  end: string
  zone: string
  rules: Record<string, CommissionRule[]>
  hiredOn?: string | null
  dismissedOn?: string | null
}): CommissionDetails {
  if (input.end < input.start) throw new Error('Кінець періоду має бути не раніше початку.')
  const lines: CommissionLine[] = [],
    conditions = new Set<string>()
  for (const o of input.orders) {
    if (o.status !== 'completed' || !o.payrollEarnedAt) continue
    const closed = zonedDayKey(o.payrollEarnedAt, input.zone)
    if (
      closed < input.start ||
      closed > input.end ||
      (input.hiredOn && closed < input.hiredOn) ||
      (input.dismissedOn && closed > input.dismissedOn)
    )
      continue
    const active = rulesAt(input.rules[input.employee] ?? [], closed)
    const order = o.invoiceNumber || `${o.title} · ${o.id}`
    const car = [o.vehicle?.make, o.vehicle?.model, o.vehicle?.licensePlate]
      .filter(Boolean)
      .join(' ')
    const factor = new D(o.subtotal).gt(0)
      ? D.max(0, new D(1).minus(new D(o.discountAmount).div(o.subtotal)))
      : new D(1)
    const tax =
      o.taxInclusive && o.taxRate > 0 ? new D(1).plus(new D(o.taxRate).div(100)) : new D(1)
    const laborSale = (l: CommissionOrder['laborItems'][number], r: CommissionRule) =>
      new D(l.total).div(tax).mul(r.afterDiscount ? factor : 1)
    const mechanicPay = (l: CommissionOrder['laborItems'][number]) => {
      if (l.subcontract) return new D(0)
      if (l.pricingType === 'shopFee') return new D(0)
      if (l.assignmentIssue) throw new Error(`${order} · ${l.description}: ${l.assignmentIssue}`)
      if (!l.technicianId) throw new Error(`Призначте механіка: ${order} · ${l.description}`)
      const ownRules = rulesAt(input.rules[l.technicianId] ?? [], closed).filter(
        (r) => r.basis === 'labor'
      )
      if (!ownRules.length)
        throw new Error(`Немає відсотка механіка на дату закриття: ${order} · ${l.description}`)
      return ownRules.reduce(
        (sum, r) => sum.plus(laborSale(l, r).mul(r.rate).div(100).toDecimalPlaces(2)),
        new D(0)
      )
    }
    for (const rule of active) {
      if (rule.scope === 'manager' && o.payAssignment?.ownerId !== input.employee) continue
      const candidates: {
        id: string
        name: string
        kind: 'labor' | 'parts'
        sale: Prisma.Decimal
        cost: Prisma.Decimal
        executorLabel?: string | null
        assignmentSource?: string | null
      }[] = []
      if (['labor', 'managerLabor', 'orderMargin'].includes(rule.basis))
        for (const l of o.laborItems) {
          if (
            rule.basis === 'labor' &&
            (l.technicianId !== input.employee || l.subcontract || l.pricingType === 'shopFee')
          )
            continue
          const sale = laborSale(l, rule)
          let cost = new D(0)
          if (rule.basis !== 'labor') {
            if (rule.deductMechanicPay) cost = cost.plus(mechanicPay(l))
            if (rule.deductSubcontractCost && l.subcontract)
              cost = cost.plus(
                D.max(0, l.subcontract.unitCost.mul(l.hours).minus(l.subcontract.returnedCost ?? 0))
              )
          }
          candidates.push({
            id: l.id,
            name: l.description,
            kind: 'labor',
            sale,
            cost,
            executorLabel: l.executorLabel,
            assignmentSource: l.assignmentSource,
          })
        }
      if (['partsSales', 'partsMargin', 'orderMargin'].includes(rule.basis))
        for (const p of o.partItems) {
          if (
            rule.scope === 'seller' &&
            (p.payrollSellerId ?? o.payAssignment?.partsId) !== input.employee
          )
            continue
          const sale = rule.afterDiscount
            ? new D(p.total).div(tax).mul(factor)
            : new D(p.unitPrice).mul(p.quantity).div(tax)
          if (rule.basis !== 'partsSales' && p.unitCost === 0)
            throw new Error(`Перевірте собівартість: ${order} · ${p.name}`)
          candidates.push({
            id: p.id,
            name: p.name,
            kind: 'parts',
            sale,
            cost: rule.basis === 'partsSales' ? new D(0) : new D(p.unitCost).mul(p.quantity),
          })
        }
      const orderLoss =
        rule.basis === 'orderMargin' &&
        !rule.includeNegative &&
        candidates.reduce((s, c) => s.plus(c.sale).minus(c.cost), new D(0)).lte(0)
      for (const c of candidates) {
        const raw = c.sale.minus(c.cost)
        const base = orderLoss
          ? new D(0)
          : rule.includeNegative || rule.basis === 'orderMargin'
            ? raw
            : D.max(0, raw)
        lines.push({
          order,
          car,
          name: c.name,
          rate: rule.rate + '%',
          base: base.toFixed(2),
          amount: base.mul(rule.rate).div(100).toFixed(2),
          plan: rule.id,
          orderId: o.id,
          lineId: c.id,
          vehicleId: o.vehicleId ?? null,
          closedAt: o.payrollEarnedAt.toISOString(),
          kind: c.kind,
          sale: c.sale.toFixed(2),
          cost: c.cost.toFixed(2),
          ruleName: rule.name,
          effective: rule.effective,
          ...(c.executorLabel
            ? { executorLabel: c.executorLabel, assignmentSource: c.assignmentSource }
            : {}),
        })
        conditions.add(
          `${rule.name} · ${rule.rate}% · з ${rule.effective} · ${rule.afterDiscount ? 'після знижок' : 'до знижок'}${['managerLabor', 'orderMargin'].includes(rule.basis) && rule.deductMechanicPay ? ' · після винагороди механіка' : ''}${['managerLabor', 'orderMargin'].includes(rule.basis) && rule.deductSubcontractCost ? ' · з відніманням витрат на підрядників' : ''}`
        )
      }
    }
  }
  return {
    version: 2,
    lines,
    conditions: [...conditions],
    total: lines.reduce((s, l) => s.plus(l.amount), new D(0)).toFixed(2),
  }
}
