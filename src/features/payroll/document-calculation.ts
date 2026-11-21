import type { TxClient } from '@/lib/db'
import { zonedDate } from '@/lib/timezone'
import { resolveExecutor } from './participants'
import { calculateCommissions } from './commission-calculator'
import { legacyRules, serializeRule } from './commission-rules'

export async function calculateDocument(
  tx: TxClient,
  organizationId: string,
  employee: string,
  start: Date,
  end: Date,
  zone: string
) {
  if (end < start) throw new Error('Кінець періоду має бути не раніше початку.')
  const people = await tx.technician.findMany({
    where: { organizationId },
    include: { payPlans: true, payRuleVersions: true },
  })
  const person = people.find((p) => p.id === employee)
  if (!person) throw new Error('Працівника не знайдено.')
  const rules = Object.fromEntries(
    people.map((p) => [p.id, [...legacyRules(p.payPlans), ...p.payRuleVersions.map(serializeRule)]])
  )
  if (!rules[employee].length) throw new Error('Налаштуйте правила нарахування працівника.')
  const from = zonedDate(
    start.getUTCFullYear(),
    start.getUTCMonth() + 1,
    start.getUTCDate(),
    0,
    0,
    zone
  )
  const until = zonedDate(
    end.getUTCFullYear(),
    end.getUTCMonth() + 1,
    end.getUTCDate() + 1,
    0,
    0,
    zone
  )
  const orders = await tx.serviceRecord.findMany({
    where: {
      organizationId,
      status: 'completed',
      payrollEarnedAt: { gte: from, lt: until },
    },
    orderBy: [{ payrollEarnedAt: 'asc' }, { id: 'asc' }],
    include: {
      vehicle: true,
      payAssignment: true,
      laborItems: {
        include: { subcontract: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      },
      partItems: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
    },
  })
  const resolvedOrders = orders.map((order) => ({
    ...order,
    laborItems: order.laborItems.map((labor) => ({
      ...labor,
      ...resolveExecutor(labor, order, people),
    })),
  }))
  const result = calculateCommissions({
    orders: resolvedOrders,
    rules,
    employee,
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    zone,
    hiredOn: person.hiredOn?.toISOString().slice(0, 10),
    dismissedOn: person.dismissedOn?.toISOString().slice(0, 10),
  })
  const warnings = resolvedOrders.flatMap((order) =>
    order.laborItems.flatMap((labor) =>
      labor.assignmentIssue
        ? [
            `Наряд ${order.invoiceNumber || order.id} · ${labor.description}: ${labor.assignmentIssue}`,
          ]
        : []
    )
  )
  return warnings.length ? { ...result, warnings } : result
}
