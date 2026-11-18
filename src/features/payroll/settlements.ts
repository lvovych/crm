'use server'

import { staffBalances, settlementPeriod } from './settlement-queries'
import { staffCan } from '@/features/employees/access'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { PermissionAction as A, PermissionSubject as S } from '@/lib/permissions'
import {
  accessibleAccounts,
  assertAccountAccess,
  assertOperationDate,
  assertFinancePermission,
} from '@/features/finance/access'
import { payrollWeek, weeklyAmounts } from './weekly'
import { cents, decimal, positiveMoney } from '@/features/finance/money'
import { postMoney } from '@/features/finance/ledger'
import { allocatePayments } from './allocation'
import { workshopTimeZone } from '@/lib/workshop-timezone'
import { zonedDayKey } from '@/lib/timezone'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'

export async function settlementData(
  query: { employee?: string; from?: string; to?: string; slip?: string } = {}
) {
  return withAuth(
    async (ctx) => {
      const today = zonedDayKey(new Date(), await workshopTimeZone(ctx.organizationId))
      const period = settlementPeriod(today, query.from, query.to)
      const people = await staffBalances(db, ctx.organizationId)
      const person = query.employee
        ? await db.technician.findFirst({
            where: { id: query.employee, organizationId: ctx.organizationId },
            include: {
              paySlips: {
                where: {
                  OR: [
                    { end: { gte: new Date(period.from), lte: new Date(period.to) } },
                    ...(query.slip ? [{ id: query.slip }] : []),
                  ],
                },
                orderBy: { start: 'asc' },
                include: {
                  allocations: {
                    where: { payment: { document: { reversal: null } } },
                    include: { payment: { include: { document: { select: { date: true } } } } },
                  },
                },
              },
              staffPayments: {
                where: {
                  document: { date: { gte: new Date(period.from), lte: new Date(period.to) } },
                },
                orderBy: { document: { date: 'asc' } },
                include: {
                  document: { include: { reversal: true } },
                  allocations: { include: { slip: { select: { start: true } } } },
                },
              },
            },
          })
        : null
      if (query.employee && !person) throw new Error('Працівника не знайдено.')
      const accounts = await accessibleAccounts(ctx, true)
      const categories = await db.cashFlowCategory.findMany({
        where: { organizationId: ctx.organizationId, isArchived: false, direction: 'expense' },
      })
      return {
        today,
        period,
        person,
        people,
        accounts,
        categories,
        canPay:
          (await staffCan(ctx, { subject: S.PAYROLL, action: A.MANAGE })) &&
          (await staffCan(ctx, { subject: S.FINANCE, action: A.UPDATE })),
      }
    },
    { requiredPermissions: [{ subject: S.PAYROLL, action: A.READ }] }
  )
}
export async function payrollDocuments(page = 1) {
  return withAuth(
    async ({ organizationId }) => {
      const current = z.number().int().min(1).max(100000).parse(page)
      const where = { technician: { organizationId } }
      const [rows, count] = await Promise.all([
        db.paySlip.findMany({
          where,
          select: {
            id: true,
            start: true,
            end: true,
            status: true,
            total: true,
            technician: { select: { id: true, name: true } },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (current - 1) * 50,
          take: 50,
        }),
        db.paySlip.count({ where }),
      ])
      return { rows, count, page: current }
    },
    { requiredPermissions: [{ subject: S.PAYROLL, action: A.READ }] }
  )
}
export async function payEmployee(form: FormData) {
  const result = await withAuth(
    async (ctx) => {
      const amount = positiveMoney.parse(form.get('amount')),
        date = z.string().date().parse(form.get('date'))
      const requestId = z.string().uuid().parse(form.get('requestId')),
        technicianId = String(form.get('employee')),
        sourceAccountId = String(form.get('account')),
        categoryId = String(form.get('category'))
      const advance = form.get('type') === 'advance'
      const targetWeek = form.has('targetWeek')
        ? z.string().date().parse(form.get('targetWeek'))
        : null
      if (targetWeek && advance) throw new Error('Для виплати за тиждень виберіть виплату.')
      await assertFinancePermission(ctx, A.UPDATE)
      await assertOperationDate(ctx, date)
      await db.$transaction(async (tx) => {
        await assertAccountAccess(ctx, [sourceAccountId], tx)
        const employee = await tx.technician.findFirstOrThrow({
          where: { id: technicianId, organizationId: ctx.organizationId },
        })
        const document = await postMoney(tx, ctx.organizationId, ctx.userId, {
          requestId,
          kind: 'expense',
          amount,
          date,
          sourceAccountId,
          categoryId,
          counterpartyLabel: employee.name,
          note:
            (advance ? 'Аванс' : 'Зарплата') +
            ' · ' +
            technicianId +
            (targetWeek ? ' · тиждень ' + targetWeek : ''),
        })
        if (await tx.staffPayment.findUnique({ where: { documentId: document.id } })) return
        const payment = await tx.staffPayment.create({
          data: { documentId: document.id, technicianId, advance },
        })
        if (targetWeek) {
          const week = payrollWeek(targetWeek)
          const slips = await tx.paySlip.findMany({
            where: { technicianId, status: 'completed', end: { lte: week.end } },
            orderBy: { end: 'asc' },
            include: {
              allocations: {
                where: { payment: { document: { reversal: null } } },
                include: { payment: { select: { advance: true } } },
              },
            },
          })
          let remaining = cents(amount)
          if (remaining > weeklyAmounts(slips, week).values[3])
            throw new Error('Залишок за тиждень змінився. Оновіть відомість.')
          for (const slip of slips) {
            if (slip.end < week.start || remaining === BigInt(0)) continue
            const balance = slip.allocations.reduce(
              (v, a) => v - cents(a.amount.toFixed(2)),
              cents(slip.total.toFixed(2))
            )
            if (balance <= BigInt(0)) continue
            const applied = remaining < balance ? remaining : balance
            await tx.staffAllocation.create({
              data: { paymentId: payment.id, slipId: slip.id, amount: decimal(applied) },
            })
            remaining -= applied
          }
          return
        }
        await allocatePayments(tx, technicianId)
      })
    },
    { requiredPermissions: [{ action: A.MANAGE, subject: S.PAYROLL }] }
  )
  if (!result.success) throw new Error(result.error)
  revalidatePath('/employee-settlements')
}
