import { z } from 'zod'
import type { TxClient } from '@/lib/db'
import { allocate, addReceiptDebt, reverseEntry, withLinks, lockSupplier } from './ledger'
import { kopecks, workshopDay, hryvnia, remaining, splitPayment } from './amounts'
const money = z.string().regex(/^\d{1,18}(\.\d{1,2})?$/)
const positive = money.refine((s) => /[1-9]/.test(s), 'Вкажіть додатну суму.')
export const operationDate = z
  .string()
  .date()
  .refine((s) => s <= workshopDay(), 'Дата операції в майбутньому.')
  .transform((s) => new Date(s + 'T00:00:00Z'))
export const operation = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('payment'),
    moneyAccountId: z.string().optional(),
    amount: positive,
    method: z.enum(['bank', 'cash', 'card']),
    reference: z.string().trim().max(150),
    note: z.string().trim().max(500),
    target: z.string().optional(),
    expectedOpen: money.optional(),
    date: operationDate,
  }),
  z.object({
    op: z.literal('allocate'),
    credit: z.string().min(1),
    targets: z
      .array(z.object({ id: z.string().min(1), amount: positive }))
      .min(1)
      .max(200),
    date: operationDate,
  }),
  z.object({
    op: z.literal('opening'),
    kind: z.enum(['opening_credit', 'opening_debt']),
    amount: positive,
    note: z.string().trim().min(1).max(500),
    date: operationDate,
  }),
  z.object({
    op: z.literal('reconcile'),
    receipt: z.string().min(1),
    amount: money,
    due: z.string().date().optional(),
    date: operationDate,
  }),
  z.object({ op: z.literal('due'), entry: z.string().min(1), due: z.string().date() }),
  z.object({
    op: z.literal('reverse'),
    kind: z.enum(['entry', 'allocation']),
    id: z.string().min(1),
    reason: z.string().trim().min(1).max(500),
  }),
])
export async function applyOperation(
  tx: TxClient,
  organizationId: string,
  supplierId: string,
  userId: string,
  requestId: string,
  d: z.infer<typeof operation>
) {
  await lockSupplier(tx, organizationId, supplierId)
  const scope = { organizationId, supplierId }
  if (d.op === 'payment' || d.op === 'opening') {
    const old = await tx.supplierEntry.findFirst({
      where: { ...scope, id: requestId },
      include: { credits: { select: { debitId: true, id: true } } },
    })
    if (old) {
      const originalTarget = old.credits.find((l) => l.id === requestId)?.debitId
      if (
        old.kind !== (d.op === 'payment' ? 'payment' : d.kind) ||
        !old.amount.equals(d.amount) ||
        old.date.getTime() !== d.date.getTime() ||
        old.note !== d.note ||
        (d.op === 'payment' &&
          (originalTarget !== d.target || old.reference !== d.reference || old.method !== d.method))
      )
        throw new Error('Запит уже виконано з іншими реквізитами. Оновіть сторінку.')
      return
    }
    if (
      d.op === 'opening' &&
      (await tx.supplierEntry.count({
        where: { ...scope, kind: { in: ['opening_credit', 'opening_debt'] }, reversedAt: null },
      }))
    )
      throw new Error('Початкове сальдо вже внесено.')
    const credit = await tx.supplierEntry.create({
      data: {
        ...scope,
        id: requestId,
        createdById: userId,
        date: d.date,
        amount: d.amount,
        note: d.note,
        kind: d.op === 'payment' ? 'payment' : d.kind,
        ...(d.op === 'payment' ? { method: d.method, reference: d.reference } : {}),
      },
    })
    if (d.op === 'payment' && d.target) {
      const debit = await tx.supplierEntry.findFirstOrThrow({
        where: { ...scope, id: d.target, reversedAt: null },
        include: withLinks,
      })
      const open = remaining(debit, debit.debits, workshopDay())
      if (d.expectedOpen !== undefined && kopecks(d.expectedOpen) !== open)
        throw new Error('Залишок змінився. Оновіть сторінку перед реєстрацією.')
      if (open <= BigInt(0)) throw new Error('Залишок документа змінився. Оновіть сторінку.')
      const { applied } = splitPayment(kopecks(d.amount), open)
      await allocate(
        tx,
        organizationId,
        supplierId,
        userId,
        requestId,
        credit.id,
        debit.id,
        hryvnia(applied),
        d.date
      )
    }
  } else if (d.op === 'allocate') {
    if (await tx.supplierAllocation.findFirst({ where: { id: requestId + '-0', credit: scope } }))
      return
    for (const [index, t] of d.targets.entries())
      await allocate(
        tx,
        organizationId,
        supplierId,
        userId,
        requestId + '-' + index,
        d.credit,
        t.id,
        t.amount,
        d.date
      )
  } else if (d.op === 'reconcile') {
    const receipt = await tx.supplierReceipt.findFirstOrThrow({
      where: { id: d.receipt, ...scope, status: 'posted' },
    })
    if (d.date < receipt.receivedDate) throw new Error('Дата звірки передує прийманню.')
    await addReceiptDebt(
      tx,
      organizationId,
      userId,
      receipt.id,
      d.date,
      d.amount,
      d.due ? new Date(d.due) : undefined
    )
  } else if (d.op === 'due') {
    const entry = await tx.supplierEntry.findFirstOrThrow({
      where: { ...scope, id: d.entry, kind: 'receipt', reversedAt: null },
    })
    const due = new Date(d.due)
    if (entry.due?.getTime() !== due.getTime()) {
      await tx.supplierTermChange.create({
        data: { entryId: entry.id, previous: entry.due, due, changedById: userId },
      })
      await tx.supplierEntry.update({ where: { id: entry.id }, data: { due } })
    }
  } else if (d.kind === 'entry') {
    const entry = await tx.supplierEntry.findFirstOrThrow({ where: { ...scope, id: d.id } })
    if (entry.kind === 'receipt') throw new Error('Скасування накладної виконується зі складу.')
    if (!entry.reversedAt)
      await reverseEntry(tx, organizationId, supplierId, entry.id, userId, d.reason)
  } else {
    await tx.supplierAllocation.updateMany({
      where: { id: d.id, credit: scope, debit: scope, reversedAt: null },
      data: { reversedAt: new Date(), reversedById: userId, reason: d.reason },
    })
  }
}
