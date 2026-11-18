import type { TxClient } from '@/lib/db'
import { calculatePayroll, periodEnd } from './calculator'
export { periodEnd, calculatePayroll } from './calculator'
export type { SlipLine } from './calculator'
const day = 86400000
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
  return calculatePayroll({ person, plan, orders, employee, start, end, zone })
}
