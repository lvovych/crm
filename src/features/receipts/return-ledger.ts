import { currentTransferred } from './return-availability'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { Prisma } from '@/generated/prisma/client'
import type { TxClient } from '@/lib/db'
import { allocate, lockSupplier } from '@/features/settlements/ledger'
import { hryvnia, kopecks, remaining, workshopDay } from '@/features/settlements/amounts'
import { storedLineAmount } from './money'

export const returnSchema = z
  .object({
    id: z.string().uuid(),
    receiptId: z.string().min(1),
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
  .refine((v) => new Set(v.lines.map((l) => l.id)).size === v.lines.length, 'Позиції повторюються.')

export async function postSupplierReturn(
  tx: TxClient,
  org: string,
  userId: string,
  raw: unknown,
  today = workshopDay()
) {
  const input = returnSchema.parse(raw)
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        ...input,
        lines: [...input.lines].sort((a, b) => a.id.localeCompare(b.id)),
      })
    )
    .digest('hex')
  const receipt = await tx.supplierReceipt.findFirstOrThrow({
    where: { id: input.receiptId, organizationId: org },
  })
  await lockSupplier(tx, org, receipt.supplierId)
  const existing = await tx.supplierReturn.findUnique({ where: { id: input.id } })
  if (existing) {
    if (existing.organizationId !== org || existing.fingerprint !== fingerprint)
      throw new Error('Цей запит уже використано для іншого повернення.')
    return existing.id
  }
  await tx.$queryRaw`SELECT id FROM "public"."supplier_receipts" WHERE id=${receipt.id} AND "organizationId"=${org} FOR UPDATE`
  const current = await tx.supplierReceipt.findFirstOrThrow({
    where: { id: receipt.id, organizationId: org },
    include: {
      settlement: { include: { debits: true } },
      lines: {
        include: { returns: true, transfers: true, subcontract: { include: { labor: true } } },
      },
    },
  })
  if (current.status !== 'posted') throw new Error('Повернення доступне з проведеної накладної.')
  if (!current.settlement || current.settlement.reversedAt)
    throw new Error('Спочатку звірте накладну у взаєморозрахунках.')
  const settings = await tx.financeSettings.findUnique({ where: { organizationId: org } })
  if (settings?.closedThrough && settings.closedThrough.toISOString().slice(0, 10) >= today)
    throw new Error('Період закрито для проведення документів.')
  if (
    current.receivedDate.toISOString().slice(0, 10) > today ||
    current.settlement.date.toISOString().slice(0, 10) > today
  )
    throw new Error('Дата повернення не може передувати приходу та його обліку.')
  const currentTransfers = await currentTransferred(tx, org, current.lines)
  const prepared = input.lines
    .map((request) => {
      const line = current.lines.find((l) => l.id === request.id)
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
      const cumulative = returned.plus(quantity)
      const amount = cumulative.equals(line.quantity)
        ? line.amount.minus(previousAmount)
        : new Prisma.Decimal(
            storedLineAmount({
              quantity: cumulative.toString(),
              unitPrice: line.unitPrice.toString(),
            })
          ).minus(previousAmount)
      return { line, quantity, amount }
    })
    .sort((a, b) => (a.line.partId ?? a.line.id).localeCompare(b.line.partId ?? b.line.id))
  const total = prepared.reduce((sum, r) => sum.plus(r.amount), new Prisma.Decimal(0))
  const number = 'ПП-' + input.id.slice(0, 8).toUpperCase()
  const date = new Date(today + 'T00:00:00Z')
  await tx.supplierReturn.create({
    data: {
      id: input.id,
      organizationId: org,
      receiptId: current.id,
      number,
      date,
      reason: input.reason,
      fingerprint,
      createdById: userId,
      lines: {
        create: prepared.map((r) => ({
          lineId: r.line.id,
          quantity: r.quantity,
          amount: r.amount,
        })),
      },
    },
  })
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
  const credit = await tx.supplierEntry.create({
    data: {
      organizationId: org,
      supplierId: current.supplierId,
      returnId: input.id,
      kind: 'return_credit',
      amount: total,
      date,
      reference: number,
      note: input.reason,
      createdById: userId,
    },
  })
  const open = remaining(current.settlement, current.settlement.debits, today)
  const applied = open < kopecks(total.toFixed(2)) ? open : kopecks(total.toFixed(2))
  if (applied > BigInt(0))
    await allocate(
      tx,
      org,
      current.supplierId,
      userId,
      input.id,
      credit.id,
      current.settlement.id,
      hryvnia(applied),
      date
    )
  return input.id
}
