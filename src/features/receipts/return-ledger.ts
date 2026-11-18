import { currentTransferred } from './return-availability'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { Prisma } from '@/generated/prisma/client'
import type { TxClient } from '@/lib/db'
import { lockSupplier } from '@/features/settlements/ledger'
import { workshopDay } from '@/features/settlements/amounts'
import { returnLineAmount } from './return-money'

export const returnSchema = z
  .object({
    id: z.string().uuid(),
    version: z.number().int().positive().optional(),
    receiptId: z.string().min(1).optional(),
    supplierId: z.string().min(1).optional(),
    supplierDocumentNumber: z.string().trim().max(120).optional(),
    reason: z.string().trim().min(1).max(1000),
    lines: z
      .array(
        z.object({
          id: z.string().min(1),
          quantity: z
            .string()
            .regex(/^\d{1,9}(\.\d{1,3})?$/)
            .refine((v) => Number(v) > 0),
        })
      )
      .min(1)
      .max(200),
  })
  .refine(
    (v) => Boolean(v.receiptId) !== Boolean(v.supplierId),
    'Оберіть накладну або постачальника.'
  )
  .refine((v) => new Set(v.lines.map((l) => l.id)).size === v.lines.length, 'Позиції повторюються.')

export async function postSupplierReturn(
  tx: TxClient,
  org: string,
  userId: string,
  raw: unknown,
  today = workshopDay(),
  mode: 'post' | 'draft' = 'post'
) {
  const input = returnSchema.parse(raw)
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        ...input,
        version: undefined,
        lines: [...input.lines].sort((a, b) => a.id.localeCompare(b.id)),
      })
    )
    .digest('hex')
  const origin = input.receiptId
    ? await tx.supplierReceipt.findFirstOrThrow({
        where: { id: input.receiptId, organizationId: org },
      })
    : null
  const supplierId = origin?.supplierId ?? input.supplierId!
  await tx.counterparty.findFirstOrThrow({ where: { id: supplierId, organizationId: org } })
  await lockSupplier(tx, org, supplierId)
  const existing = await tx.supplierReturn.findUnique({ where: { id: input.id } })
  if (existing) {
    if (existing.organizationId !== org || existing.supplierId !== supplierId)
      throw new Error('Документ недоступний.')
    if (
      existing.status === 'posted' ||
      (mode === 'draft' && existing.fingerprint === fingerprint)
    ) {
      if (existing.fingerprint !== fingerprint)
        throw new Error(
          'Цей запит уже використано для іншого повернення. Проведений документ не можна змінити.'
        )
      return existing.id
    }
    if (existing.version !== input.version)
      throw new Error('Документ уже змінено. Оновіть сторінку.')
  }
  const sourceIds = await tx.supplierReceipt.findMany({
    where: {
      organizationId: org,
      supplierId,
      ...(input.receiptId ? { id: input.receiptId } : {}),
      lines: { some: { id: { in: input.lines.map((l) => l.id) } } },
    },
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  if (!sourceIds.length)
    throw new Error(
      input.receiptId
        ? 'Оберіть позиції цієї накладної.'
        : 'Оберіть позиції накладних цього постачальника.'
    )
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "public"."supplier_receipts" WHERE "organizationId"=${org} AND id IN (${Prisma.join(sourceIds.map((r) => r.id))}) ORDER BY id FOR UPDATE`
  )
  const receipts = await tx.supplierReceipt.findMany({
    where: { organizationId: org, supplierId, id: { in: sourceIds.map((r) => r.id) } },
    orderBy: { id: 'asc' },
    include: {
      settlement: { include: { debits: true } },
      lines: {
        include: {
          returns: { where: { document: { status: 'posted' } } },
          transfers: true,
          part: { include: { brand: true } },
          subcontract: { include: { labor: true } },
        },
      },
    },
  })
  const allLines = receipts.flatMap((r) => r.lines)
  if (input.lines.some((request) => !allLines.some((line) => line.id === request.id)))
    throw new Error(
      input.receiptId
        ? 'Оберіть позиції цієї накладної.'
        : 'Оберіть позиції накладних цього постачальника.'
    )
  for (const current of receipts) {
    if (current.status !== 'posted') throw new Error('Повернення доступне з проведеної накладної.')
    if (!current.settlement || current.settlement.reversedAt)
      throw new Error('Спочатку звірте накладну у взаєморозрахунках.')
    if (
      current.receivedDate.toISOString().slice(0, 10) > today ||
      current.settlement.date.toISOString().slice(0, 10) > today
    )
      throw new Error('Дата повернення не може передувати приходу та його обліку.')
  }
  const settings = await tx.financeSettings.findUnique({ where: { organizationId: org } })
  if (settings?.closedThrough && settings.closedThrough.toISOString().slice(0, 10) >= today)
    throw new Error('Період закрито для проведення документів.')
  const currentTransfers = await currentTransferred(tx, org, allLines)
  const prepared = input.lines
    .map((request) => {
      const line = allLines.find((l) => l.id === request.id)
      if (!line) throw new Error('Оберіть позиції цієї накладної.')
      const returned = line.returns.reduce((sum, r) => sum.plus(r.quantity), new Prisma.Decimal(0))
      const transferred = currentTransfers.get(line.id)!
      const quantity = new Prisma.Decimal(request.quantity)
      if (quantity.gt(line.quantity.minus(returned).minus(transferred)))
        throw new Error('«' + line.name + '»: кількість перевищує доступну для повернення.')
      // Cumulative rounding guarantees that all partial returns add up to the original line.
      const previousAmount = line.returns.reduce(
        (sum, r) => sum.plus(r.amount),
        new Prisma.Decimal(0)
      )
      const amount = new Prisma.Decimal(
        returnLineAmount(
          {
            originalQuantity: line.quantity.toString(),
            originalAmount: line.amount.toFixed(2),
            returnedQuantity: returned.toString(),
            returnedAmount: previousAmount.toFixed(2),
            unitPrice: line.unitPrice.toString(),
          },
          quantity.toString()
        )
      )
      return { line, quantity, amount }
    })
    .sort((a, b) => (a.line.partId ?? a.line.id).localeCompare(b.line.partId ?? b.line.id))
  const total = prepared.reduce((sum, r) => sum.plus(r.amount), new Prisma.Decimal(0))
  const number = 'ПП-' + input.id.slice(0, 8).toUpperCase()
  const date = new Date(today + 'T00:00:00Z')
  const data = {
    id: input.id,
    organizationId: org,
    receiptId: input.receiptId ?? null,
    supplierId,
    number,
    date,
    reason: input.reason,
    supplierDocumentNumber: input.supplierDocumentNumber || null,
    fingerprint,
    status: mode === 'draft' ? 'draft' : 'posted',
    postedById: mode === 'post' ? userId : null,
    postedAt: mode === 'post' ? new Date() : null,
    lines: {
      create: prepared.map((r) => ({
        lineId: r.line.id,
        brandSnapshot: r.line.part?.brand.name ?? null,
        articleSnapshot: r.line.article || r.line.part?.partNumber || null,
        quantity: r.quantity,
        amount: r.amount,
      })),
    },
  }
  if (existing) {
    await tx.supplierReturnLine.deleteMany({ where: { returnId: existing.id } })
    await tx.supplierReturn.update({
      where: { id: existing.id },
      data: { ...data, version: { increment: 1 } },
    })
  } else {
    await tx.supplierReturn.create({ data: { ...data, createdById: userId } })
  }
  if (mode === 'draft') return input.id
  for (const { line, quantity, amount } of prepared) {
    if (line.kind === 'part') {
      if (!line.partId) throw new Error('Позицію не зіставлено зі складом.')
      const rows = await tx.$queryRaw<{ quantity: number }[]>(Prisma.sql`
        UPDATE "public"."inventory_parts" SET quantity=ROUND((quantity::numeric-${quantity.toString()}::numeric),3)::float8,
        "updatedAt"=NOW() WHERE id=${line.partId} AND "organizationId"=${org}
        AND COALESCE(NULLIF(unit,''),'шт')=${line.unit}
        AND quantity::numeric>=${quantity.toString()}::numeric RETURNING quantity`)
      if (!rows.length)
        throw new Error('«' + line.name + '»: перевірте залишок і одиницю на складі.')
      await tx.stockMovement.create({
        data: {
          organizationId: org,
          userId,
          inventoryPartId: line.partId,
          receiptLineId: line.id,
          reason: 'supplier_return',
          note: number + ' · ' + input.reason,
          delta: quantity.negated().toNumber(),
          quantityAfter: rows[0].quantity,
        },
      })
    } else if (line.subcontract) {
      await tx.subcontractWork.update({
        where: { laborId: line.subcontract.laborId },
        data: { returnedCost: { increment: amount } },
      })
    }
  }
  await tx.supplierEntry.create({
    data: {
      organizationId: org,
      supplierId,
      returnId: input.id,
      kind: 'return_credit',
      amount: total,
      date,
      reference: number,
      note: input.reason,
      createdById: userId,
    },
  })
  // A return is an independent supplier credit, not a payment of source invoices.
  // Supplier totals subtract this credit (including overdue), without creating an advance.
  return input.id
}
