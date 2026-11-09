import {
  addReceiptDebt,
  lockSupplier,
  reverseEntry,
  settlementsEnabled,
} from '@/features/settlements/ledger'
import { workshopDay } from '@/features/settlements/amounts'
import { z } from 'zod'
import { Prisma } from '@/generated/prisma/client'
import type { TxClient } from '@/lib/db'

const date = z
  .string()
  .date()
  .transform((v) => new Date(v + 'T00:00:00Z'))
export const draftSchema = z.object({
  id: z.string().min(1).max(100),
  version: z.number().int().nonnegative(),
  supplierId: z.string().min(1),
  number: z.string().trim().min(1).max(100),
  documentDate: date,
  receivedDate: date,
  lines: z
    .array(
      z.object({
        brandId: z.string().min(1).optional(),
        article: z.string().trim().max(120).optional(),
        kind: z.enum(['part', 'service']),
        name: z.string().trim().min(1).max(250),
        unit: z.string().trim().min(1).max(30),
        partId: z.string().nullable(),
        quantity: z
          .string()
          .regex(/^\d{1,9}(\.\d{1,3})?$/)
          .refine((v) => Number(v) > 0),
        unitPrice: z.string().regex(/^\d{1,9}(\.\d{1,4})?$/),
      })
    )
    .min(1)
    .max(200),
})

export async function transitionReceipt(
  tx: TxClient,
  organizationId: string,
  userId: string,
  id: string,
  version: number,
  target: 'posted' | 'cancelled',
  reason: string
) {
  const receipt = await tx.supplierReceipt.findFirstOrThrow({
    where: { id, organizationId },
    include: { lines: { orderBy: [{ partId: 'asc' }, { position: 'asc' }] } },
  })
  if (receipt.status === target) return
  const posting = target === 'posted'
  if (!posting && !reason.trim()) throw new Error('Вкажіть причину скасування.')
  if (
    posting &&
    !(await tx.counterparty.count({
      where: { id: receipt.supplierId, organizationId, isArchived: false },
    }))
  )
    throw new Error('Постачальника архівовано.')
  await lockSupplier(tx, organizationId, receipt.supplierId)
  const changed = await tx.supplierReceipt.updateMany({
    where: { id, organizationId, status: posting ? 'draft' : 'posted', version },
    data: {
      status: target,
      version: { increment: 1 },
      ...(posting
        ? { postedAt: new Date(), postedById: userId }
        : { cancelledAt: new Date(), cancelledById: userId, cancelReason: reason.trim() }),
    },
  })
  if (!changed.count) throw new Error('Документ змінився. Оновіть сторінку.')
  if (!posting && (await tx.receiptTransfer.count({ where: { line: { receiptId: id } } })))
    throw new Error(
      'Накладна має передавання в наряди. Скасування потребує окремої звірки руху товарів.'
    )
  for (const line of receipt.lines) {
    if (line.kind === 'service') continue
    if (posting && !line.article?.trim()) throw new Error('Додайте артикул товару в чернетці.')
    if (!line.partId) throw new Error('Зіставте усі запчастини зі складом.')
    const delta = posting ? line.quantity : line.quantity.negated()
    // Lock rows in stable part order. The guarded update reads the current balance even
    // when another receipt or work order changes this part concurrently.
    const rows = await tx.$queryRaw<{ quantity: number }[]>(
      Prisma.sql`UPDATE "public"."inventory_parts"
        SET quantity=ROUND((quantity::numeric + ${delta.toString()}::numeric),3)::float8, "updatedAt"=NOW()
        WHERE id=${line.partId} AND "organizationId"=${organizationId}
          AND COALESCE(NULLIF(unit,''),'шт')=${line.unit}
          AND (${!posting} OR NOT "isArchived")
          AND (${posting} OR quantity::numeric >= ${line.quantity.toString()}::numeric)
        RETURNING quantity`
    )
    if (!rows.length) {
      const part = await tx.inventoryPart.findFirst({
        where: { id: line.partId, organizationId },
        select: { quantity: true },
      })
      throw new Error(
        'Перевірте залишок, одиницю і статус «' +
          line.name +
          '». Доступно: ' +
          (part?.quantity ?? 0)
      )
    }
    await tx.stockMovement.create({
      data: {
        organizationId,
        userId,
        inventoryPartId: line.partId,
        receiptLineId: line.id,
        reason: posting ? 'supplier_receipt' : 'supplier_receipt_cancelled',
        note: receipt.number,
        delta: delta.toNumber(),
        quantityAfter: rows[0].quantity,
      },
    })
  }
  if (posting && settlementsEnabled(organizationId)) {
    await addReceiptDebt(tx, organizationId, userId, id, new Date(workshopDay() + 'T00:00:00Z'))
  } else if (!posting) {
    const entry = await tx.supplierEntry.findUnique({ where: { receiptId: id } })
    if (entry && !entry.reversedAt)
      await reverseEntry(tx, organizationId, receipt.supplierId, entry.id, userId, reason)
  }
}
