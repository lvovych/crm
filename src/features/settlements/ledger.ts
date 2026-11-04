import { Prisma } from '@/generated/prisma/client'
import type { TxClient } from '@/lib/db'
import { receiptTotal } from '@/features/receipts/money'
import { day, hryvnia, isCredit, kopecks, remaining, workshopDay } from './amounts'
export function settlementsEnabled(org: string) {
  return (process.env.SUPPLIER_SETTLEMENT_ORGANIZATIONS ?? '')
    .split(',')
    .map((s) => s.trim())
    .some((v) => v === org || v === '*')
}
export async function lockSupplier(tx: TxClient, org: string, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM "public"."counterparties" WHERE id=${id} AND "organizationId"=${org} FOR UPDATE`
  )
  if (!rows.length) throw new Error('Постачальника не знайдено.')
}
export async function addReceiptDebt(
  tx: TxClient,
  org: string,
  userId: string,
  id: string,
  date: Date,
  amount?: string,
  dueOverride?: Date
) {
  const r = await tx.supplierReceipt.findFirstOrThrow({
    where: { organizationId: org, id, status: 'posted' },
    include: { supplier: { include: { supplierProfile: true } }, lines: true },
  })
  const days = r.supplier.supplierProfile?.paymentTermDays
  const due = new Date(r.receivedDate)
  if (days != null) due.setUTCDate(due.getUTCDate() + days)
  const total = receiptTotal(r.lines)
  if (amount !== undefined && kopecks(amount) > kopecks(total))
    throw new Error('Відкритий залишок перевищує суму накладної.')
  return tx.supplierEntry.create({
    data: {
      organizationId: org,
      supplierId: r.supplierId,
      receiptId: id,
      kind: 'receipt',
      amount: amount ?? total,
      date,
      due: dueOverride ?? (days == null ? null : due),
      reference: r.number,
      createdById: userId,
    },
  })
}
export async function reverseEntry(
  tx: TxClient,
  org: string,
  supplierId: string,
  id: string,
  userId: string,
  reason: string
) {
  const where = { id, organizationId: org, supplierId, reversedAt: null }
  const data = { reversedAt: new Date(), reversedById: userId, reason }
  if (!(await tx.supplierEntry.updateMany({ where, data })).count)
    throw new Error('Запис уже змінено.')
  await tx.supplierAllocation.updateMany({
    where: { OR: [{ creditId: id }, { debitId: id }], reversedAt: null },
    data,
  })
}
export const withLinks = { credits: true, debits: true } as const
export async function allocate(
  tx: TxClient,
  org: string,
  supplierId: string,
  userId: string,
  id: string,
  creditId: string,
  debitId: string,
  amount: string,
  date: Date
) {
  const scope = { organizationId: org, supplierId, reversedAt: null }
  const credit = await tx.supplierEntry.findFirstOrThrow({
    where: { ...scope, id: creditId },
    include: withLinks,
  })
  const debit = await tx.supplierEntry.findFirstOrThrow({
    where: { ...scope, id: debitId },
    include: withLinks,
  })
  if (!isCredit(credit.kind) || isCredit(debit.kind) || date < credit.date || date < debit.date)
    throw new Error('Перевірте документи та дату зарахування.')
  const sum = kopecks(amount)
  // Check every subsequent balance boundary for backdated allocations as well as today.
  const links = [...credit.credits, ...debit.debits]
  const dates = new Set([
    day(date),
    workshopDay(),
    ...links.flatMap((l) => [day(l.date), ...(l.reversedAt ? [workshopDay(l.reversedAt)] : [])]),
  ])
  for (const d of dates)
    if (
      d >= day(date) &&
      (sum > remaining(credit, credit.credits, d) || sum > remaining(debit, debit.debits, d))
    )
      throw new Error('Сума перевищує доступний аванс або борг.')
  if (sum <= BigInt(0)) throw new Error('Сума має бути більшою за нуль.')
  return tx.supplierAllocation.create({
    data: { id, creditId, debitId, createdById: userId, date, amount: hryvnia(sum) },
  })
}
