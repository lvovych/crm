'use server'

import { staffCan } from '@/features/employees/access'
import { allocatePayments } from './allocation'

import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, type AuthContext } from '@/lib/with-auth'
import { PermissionAction as A, PermissionSubject as S } from '@/lib/permissions'
import { workshopTimeZone } from '@/lib/workshop-timezone'
import { revalidatePath } from 'next/cache'
import { calculate } from './calculation'
import { cents, decimal, positiveMoney } from '@/features/finance/money'
import { fingerprint, lockFinance } from '@/features/finance/ledger'

const manage = { requiredPermissions: [{ action: A.MANAGE, subject: S.PAYROLL }] }
const read = { requiredPermissions: [{ action: A.READ, subject: S.PAYROLL }] }
const iso = (value: unknown) => new Date(z.string().date().parse(value))
async function change(fn: (ctx: AuthContext) => Promise<void>) {
  const r = await withAuth(fn, manage)
  if (!r.success) throw new Error(r.error)
  revalidatePath('/payroll')
}
export async function payrollData(id: string) {
  return withAuth(async (ctx) => {
    const { organizationId } = ctx
    const people = await db.technician.findMany({
      where: { organizationId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })
    const employee = people.find((p) => p.id === id) || people[0]
    const plans = employee
      ? await db.payPlan.findMany({
          where: { technicianId: employee.id },
          orderBy: { effective: 'desc' },
        })
      : []
    const slips = employee
      ? await db.paySlip.findMany({
          where: { technicianId: employee.id },
          orderBy: { start: 'desc' },
        })
      : []
    const rules = await db.salaryRule.findMany({ where: { organizationId }, orderBy: { name: 'asc' } })
    return {
      rules, people,
      employee,
      plans,
      slips,
      canManage: await staffCan(ctx, { subject: S.PAYROLL, action: A.MANAGE }),
    }
  }, read)
}
const bases = z.enum(['monthly', 'labor', 'partsSales', 'partsMargin', 'orderMargin'])
export async function createRule(form: FormData) {
  await change(async ({ organizationId }) => {
    const basis = bases.parse(form.get('basis'))
    const rate = z.coerce.number().positive().max(basis === 'monthly' ? 999999999 : 100).multipleOf(.01).parse(form.get('rate'))
    const name = z.string().trim().min(1).max(160).parse(form.get('name'))
    await db.salaryRule.create({ data: { organizationId, basis, rate, name } })
  })
}
export async function savePlan(form: FormData) {
  await change(async ({ organizationId }) => {
    const technicianId = String(form.get('employee'))
    const effective = iso(form.get('effective'))
    const frequency = z.enum(['weekly', 'twice', 'monthly']).parse(form.get('frequency'))
    await db.$transaction(async (tx) => {
      await lockFinance(tx, organizationId)
      await tx.technician.findFirstOrThrow({
        where: { id: technicianId, organizationId, dismissedOn: null },
      })
      if (await tx.paySlip.findFirst({ where: { technicianId, status: 'completed', end: { gte: effective } } }))
        throw new Error('Уже проведено листок за цей період.')
      const ids = z.array(z.string()).min(1).parse(form.getAll('rule'))
      const rules = await tx.salaryRule.findMany({ where: { organizationId, id: { in: ids } } })
      if (rules.length !== ids.length) throw new Error('Невідоме правило.')
      const amounts = { monthly: 0, labor: 0, partsSales: 0, partsMargin: 0, orderMargin: 0 }
      for (const rule of rules) {
        const basis = bases.parse(rule.basis)
        if (amounts[basis]) throw new Error('Оберіть одне правило для кожної бази.')
        amounts[basis] = rule.rate.toNumber()
      }
      await tx.payPlan.create({
        data: {
          technicianId,
          effective,
          frequency,
          ...amounts, ruleIds: ids,
          afterDiscount: form.has('afterDiscount'),
          includeNegativeOrderMargin: form.has('includeNegativeOrderMargin'),
          marginAfterDiscount: form.has('marginAfterDiscount'),
        },
      })
    })
  })
}
export async function assignOrder(form: FormData) {
  await change(async ({ organizationId }) => {
    const orderId = String(form.get('order')).trim()
    const employee = String(form.get('employee'))
    const field = z.enum(['partsId', 'ownerId']).parse(form.get('role'))
    await db.$transaction(async (tx) => {
      await tx.technician.findFirstOrThrow({ where: { id: employee, organizationId } })
      const order = await tx.serviceRecord.findFirstOrThrow({
        where: { organizationId, OR: [{ id: orderId }, { invoiceNumber: orderId }] },
      })
      await tx.payAssignment.upsert({
        where: { orderId: order.id },
        create: { orderId: order.id, [field]: employee },
        update: { [field]: employee },
      })
    })
  })
}
export async function previewSlip(employee: string, start: string, end?: string) {
  return withAuth(
    async ({ organizationId }) =>
      calculate(db, organizationId, employee, iso(start), await workshopTimeZone(organizationId), end ? iso(end) : undefined),
    read
  )
}
export async function postSlip(form: FormData) {
  await change(async ({ organizationId, userId }) => {
    const technicianId = String(form.get('employee')),
      start = iso(form.get('start'))
    const zone = await workshopTimeZone(organizationId)
    await db.$transaction(async (tx) => {
      await lockFinance(tx, organizationId)
      const { end, total, lines } = await calculate(tx, organizationId, technicianId, start, zone, form.has('end') ? iso(form.get('end')) : undefined)
      if (
        await tx.paySlip.findFirst({
          where: { technicianId, start: { lte: end }, end: { gte: start } },
        })
      )
        throw new Error('Період перетинається з проведеним листком.')
      if (fingerprint(lines) !== form.get('preview'))
        throw new Error('Дані змінилися. Оновіть попередній розрахунок.')
      let payable = cents(total)
      if (form.get('adjustAmount') && Number(form.get('adjustAmount')) !== 0) {
        const value = positiveMoney.parse(form.get('adjustAmount'))
        const reason = z.string().trim().min(1).max(300).parse(form.get('reason'))
        const deduct = z.enum(['deduct', 'bonus']).parse(form.get('adjustType')) === 'deduct'
        const amount = deduct ? '-' + value : value
        lines.push({
          order: '',
          car: '',
          name: (deduct ? 'Утримання · ' : 'Донарахування · ') + reason,
          rate: '',
          base: value,
          amount,
          plan: '',
        })
        payable += cents(amount)
      }
      await tx.paySlip.create({
        data: { status: form.get('draft') === 'yes' ? 'new' : 'completed', technicianId, start, end, total: decimal(payable), lines, actorId: userId },
      })
      if (form.get('draft') !== 'yes') await allocatePayments(tx, technicianId)
    })
  })
}

export async function orderTeam(orderId: string) {
  return withAuth(async ({ organizationId }) => {
    const order = await db.serviceRecord.findFirst({
      where: { id: orderId, organizationId },
      select: {
        payAssignment: true,
        partItems: {
          select: { id: true, name: true, payrollSellerId: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    })
    const people = await db.technician.findMany({
      where: { organizationId, dismissedOn: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })
    return { order, people }
  }, manage)
}
export async function saveOrderTeam(form: FormData) {
  await change(async ({ organizationId }) => {
    const orderId = String(form.get('order'))
    const partsId = String(form.get('partsId') || '') || null,
      ownerId = String(form.get('ownerId') || '') || null
    await db.$transaction(async (tx) => {
      await lockFinance(tx, organizationId)
      const order = await tx.serviceRecord.findFirstOrThrow({
        where: { id: orderId, organizationId },
        select: { vehicleId: true, partItems: { select: { id: true } } },
      })
      const overrides = order.partItems.map((p) => ({
        id: p.id,
        seller: String(form.get('part-' + p.id) || '') || null,
      }))
      const ids = [
        ...new Set(
          [partsId, ownerId, ...overrides.map((p) => p.seller)].filter((id): id is string => !!id)
        ),
      ]
      if (
        (await tx.technician.count({ where: { id: { in: ids }, organizationId } })) !== ids.length
      )
        throw new Error('Працівник іншої організації.')
      await tx.payAssignment.upsert({
        where: { orderId },
        create: { orderId, partsId, ownerId },
        update: { partsId, ownerId },
      })
      for (const p of overrides)
        await tx.servicePart.update({
          where: { id: p.id, serviceRecordId: orderId },
          data: { payrollSellerId: p.seller },
        })
      if (order.vehicleId) revalidatePath('/vehicles/' + order.vehicleId + '/service/' + orderId)
    })
  })
}

export async function finishSAL(form: FormData) {
  await change(async ({ organizationId }) => {
    await db.$transaction(async tx => {
      await lockFinance(tx, organizationId)
      const slip = await tx.paySlip.findFirstOrThrow({ where: { id: String(form.get('slip')), technician: { organizationId } } })
      if (slip.status === 'completed') return
      await tx.paySlip.update({ where: { id: slip.id }, data: { status: 'completed' } })
      await allocatePayments(tx, slip.technicianId)
    })
  })
  revalidatePath('/employees')
  revalidatePath('/employee-settlements')
}
