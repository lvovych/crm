import { includesDiscounts, ruleLabels, ruleConditions, type Basis } from './rules'
import { Prisma } from '@/generated/prisma/client'
import type { TxClient } from '@/lib/db'
import { zonedDayKey } from '@/lib/timezone'

export type SlipLine = {
  order: string
  car: string
  name: string
  rate: string
  base: string
  amount: string
  plan: string
}
const D = Prisma.Decimal
const day = 86400000
export function periodEnd(start: Date, frequency: string) {
  const end = new Date(start)
  if (frequency === 'weekly') {
    if (start.getUTCDay() !== 1) throw new Error('Оберіть понеділок.')
    end.setUTCDate(end.getUTCDate() + 6)
  } else if (frequency === 'twice' && start.getUTCDate() === 1) end.setUTCDate(15)
  else {
    if (start.getUTCDate() !== (frequency === 'twice' ? 16 : 1))
      throw new Error('Оберіть початок розрахункового періоду.')
    end.setUTCMonth(end.getUTCMonth() + 1, 0)
  }
  return end
}
export async function calculate(
  tx: TxClient,
  org: string,
  employee: string,
  start: Date,
  zone: string,
  selectedEnd?: Date
) {
  const person = await tx.technician.findFirstOrThrow({
    where: { id: employee, organizationId: org },
    include: { payPlans: { orderBy: { effective: 'desc' }, take: 1 } },
  })
  const plan = person.payPlans[0]
  if (!plan) throw new Error('У працівника немає правил нарахування.')
  const end = selectedEnd ?? periodEnd(start, plan.frequency)
  if (end < start) throw new Error('Кінець періоду має бути не раніше початку.')
  const conditions = (Object.keys(ruleLabels) as Basis[]).filter(b => plan[b].gt(0)).map(b =>
    ruleLabels[b] + ' · ' + plan[b].toString() + (b === 'monthly' ? ' грн' : '%') + ' · ' + ruleConditions(b, plan))
  const lines: SlipLine[] = []
  function push(
    order: string,
    car: string,
    name: string,
    rate: string,
    base: Prisma.Decimal,
    amount: Prisma.Decimal,
    plan: string
  ) {
    lines.push({ order, car, name, rate, base: base.toFixed(2), amount: amount.toFixed(2), plan })
  }
  for (let t = start.getTime(); t <= end.getTime(); t += day) {
    const date = new Date(t)
    if ((person.hiredOn && date < person.hiredOn) || (person.dismissedOn && date > person.dismissedOn)) continue
    if (plan.monthly.gt(0)) {
      const days = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
      const part = (n: number) => plan.monthly.mul(n).div(days).toDecimalPlaces(2)
      push(
        '',
        '',
        'Оклад · ' + date.toISOString().slice(0, 10),
        '1/' + days,
        plan.monthly,
        part(date.getUTCDate()).minus(part(date.getUTCDate() - 1)),
        plan.id
      )
    }
  }
  const orders = await tx.serviceRecord.findMany({
    where: {
      organizationId: org,
      status: 'completed',
      payrollEarnedAt: { gte: new Date(+start - day), lt: new Date(+end + 2 * day) },
      OR: [
        { laborItems: { some: { technicianId: employee } } },
        { payAssignment: { partsId: employee } },
        { partItems: { some: { payrollSellerId: employee } } },
        { payAssignment: { ownerId: employee } },
      ],
    },
    orderBy: [{ payrollEarnedAt: 'asc' }, { id: 'asc' }],
    include: {
      vehicle: true,
      payAssignment: true,
      partItems: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
      laborItems: {
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        include: { subcontract: true },
      },
    },
  })
  for (const o of orders) {
    const date = new Date(zonedDayKey(o.payrollEarnedAt!, zone))
    if (date < start || date > end || (person.hiredOn && date < person.hiredOn) || (person.dismissedOn && date > person.dismissedOn)) continue
    const car = [o.vehicle?.make, o.vehicle?.model, o.vehicle?.licensePlate]
      .filter(Boolean)
      .join(' ')
    const order = o.invoiceNumber || o.title + ' · ' + o.id
    const subtotal = new D(o.subtotal)
    const factor = subtotal.gt(0)
      ? D.max(0, new D(1).minus(new D(o.discountAmount).div(subtotal)))
      : new D(1)
    const taxDivisor =
      o.taxInclusive && o.taxRate > 0 ? new D(1).plus(new D(o.taxRate).div(100)) : new D(1)
    const commission = (name: string, rate: Prisma.Decimal, base: Prisma.Decimal) => {
      if (rate.gt(0))
        push(order, car, name, rate.toString() + '%', base, base.mul(rate).div(100), plan.id)
    }
    let margin = new D(0)
    for (const labor of o.laborItems) {
      const amount = new D(labor.total).div(taxDivisor)
      if (labor.technicianId === employee && !labor.subcontract)
        commission(labor.description, plan.labor, includesDiscounts('labor', plan) ? amount.mul(factor) : amount)
      margin = margin.plus(includesDiscounts('orderMargin', plan) ? amount.mul(factor) : amount)
      if (labor.subcontract) margin = margin.minus(labor.subcontract.unitCost.mul(labor.hours))
    }
    for (const p of o.partItems) {
      const seller = p.payrollSellerId ?? o.payAssignment?.partsId
      const sale = new D(p.total).div(taxDivisor).mul(factor),
        gross = new D(p.unitPrice).mul(p.quantity).div(taxDivisor),
        cost = new D(p.unitCost).mul(p.quantity)
      const selected = includesDiscounts('partsSales', plan) ? sale : gross
      const profit = (basis: 'partsMargin' | 'orderMargin') => (includesDiscounts(basis, plan) ? sale : gross).minus(cost)
      if (
        p.unitCost === 0 &&
        ((seller === employee && plan.partsMargin.gt(0)) ||
          (o.payAssignment?.ownerId === employee && plan.orderMargin.gt(0)))
      )
        throw new Error('Перевірте собівартість: ' + order + ' · ' + p.name)
      if (seller === employee) {
        commission(p.name + ' · продаж', plan.partsSales, selected)
        commission(p.name + ' · маржа', plan.partsMargin, profit('partsMargin'))
      }
      margin = margin.plus(profit('orderMargin'))
    }
    if (o.payAssignment?.ownerId === employee) {
      const base = plan.includeNegativeOrderMargin ? margin : D.max(0, margin)
      const label =
        margin.lt(0) && !plan.includeNegativeOrderMargin
          ? 'Маржа наряду · збиток ' + margin.abs().toFixed(2) + ' грн виключено з бази'
          : 'Маржа наряду'
      commission(label, plan.orderMargin, base)
    }
  }
  return { end, lines, conditions, total: lines.reduce((sum, l) => sum.plus(l.amount), new D(0)).toFixed(2) }
}
