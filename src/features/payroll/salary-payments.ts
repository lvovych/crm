'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { db, type TxClient } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { PermissionAction as A, PermissionSubject as S } from '@/lib/permissions'
import {
  accessibleAccounts,
  assertAccountAccess,
  assertFinancePermission,
  assertOperationDate,
} from '@/features/finance/access'
import { cents, decimal, positiveMoney } from '@/features/finance/money'
import { lockFinance, postMoney } from '@/features/finance/ledger'
import { workshopTimeZone } from '@/lib/workshop-timezone'
import { zonedDayKey } from '@/lib/timezone'

const manage = { requiredPermissions: [{ action: A.MANAGE, subject: S.PAYROLL }] }
async function salaryCategory(tx: TxClient, organizationId: string) {
  const categories = await tx.cashFlowCategory.findMany({
    where: { organizationId, direction: 'expense' },
    orderBy: { id: 'asc' },
  })
  const system = categories.find((c) => c.systemCode === 'payroll_salary')
  if (system?.isArchived)
    throw new Error('Стаття «Зарплати» архівна. Відновіть її в налаштуваннях каси.')
  return (
    system ??
    categories.find(
      (c) =>
        !c.isArchived &&
        ['зарплати', 'зарплата', 'заробітна плата'].includes(
          c.name.trim().toLocaleLowerCase('uk-UA')
        )
    )
  )
}
const allocations = { where: { payment: { document: { reversal: null } } } } as const

export async function salaryPaymentOptions(slipId: string) {
  return withAuth(async (ctx) => {
    await assertFinancePermission(ctx, A.UPDATE)
    const slip = await db.paySlip.findFirstOrThrow({
      where: {
        id: slipId,
        status: 'completed',
        technician: { organizationId: ctx.organizationId },
      },
      include: { allocations },
    })
    const remaining =
      cents(slip.total.toFixed(2)) -
      slip.allocations.reduce((sum, a) => sum + cents(a.amount.toFixed(2)), BigInt(0))
    const accounts = await accessibleAccounts(ctx, true)
    const category = await salaryCategory(db, ctx.organizationId)
    return {
      remaining: decimal(remaining > BigInt(0) ? remaining : BigInt(0)),
      today: zonedDayKey(new Date(), await workshopTimeZone(ctx.organizationId)),
      accounts: accounts.filter((a) => !a.isArchived).map((a) => ({ id: a.id, name: a.name })),
      categoryName: category?.name ?? 'Зарплати',
    }
  }, manage)
}

export async function paySalaryDocument(input: unknown) {
  return withAuth(async (ctx) => {
    const p = z
      .object({
        slipId: z.string().min(1),
        requestId: z.string().uuid(),
        account: z.string().min(1),
        amount: positiveMoney,
        date: z.string().date(),
      })
      .parse(input)
    await assertFinancePermission(ctx, A.UPDATE)
    await assertOperationDate(ctx, p.date)
    const result = await db.$transaction(async (tx) => {
      await lockFinance(tx, ctx.organizationId)
      await assertAccountAccess(ctx, [p.account], tx)
      const slip = await tx.paySlip.findFirstOrThrow({
        where: {
          id: p.slipId,
          status: 'completed',
          technician: { organizationId: ctx.organizationId },
        },
        include: { allocations, technician: true },
      })
      const category =
        (await salaryCategory(tx, ctx.organizationId)) ??
        (await tx.cashFlowCategory.create({
          data: {
            organizationId: ctx.organizationId,
            name: 'Зарплати',
            direction: 'expense',
            systemCode: 'payroll_salary',
          },
        }))
      const document = await postMoney(tx, ctx.organizationId, ctx.userId, {
        requestId: p.requestId,
        kind: 'expense',
        date: p.date,
        amount: p.amount,
        sourceAccountId: p.account,
        categoryId: category.id,
        counterpartyLabel: slip.technician.name,
        note: 'Зарплата · нарахування ' + slip.id,
      })
      const existing = await tx.staffPayment.findUnique({ where: { documentId: document.id } })
      if (existing) return { documentId: document.id }
      const remaining =
        cents(slip.total.toFixed(2)) -
        slip.allocations.reduce((sum, a) => sum + cents(a.amount.toFixed(2)), BigInt(0))
      if (cents(p.amount) > remaining)
        throw new Error('Сума перевищує залишок за нарахуванням. Оновіть дані про виплату.')
      const payment = await tx.staffPayment.create({
        data: { documentId: document.id, technicianId: slip.technicianId, advance: false },
      })
      await tx.staffAllocation.create({
        data: { paymentId: payment.id, slipId: slip.id, amount: p.amount },
      })
      return { documentId: document.id }
    })
    for (const path of [
      '/payroll',
      '/finance',
      '/documents',
      '/employees',
      '/employee-settlements',
    ])
      revalidatePath(path)
    revalidatePath('/employees/[id]', 'page')
    return result
  }, manage)
}
