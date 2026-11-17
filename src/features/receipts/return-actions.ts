'use server'
import { lockFinance } from '@/features/finance/ledger'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { PermissionAction as A, PermissionSubject as S } from '@/lib/permissions'
import { receiptsEnabled } from './enabled'
import { postSupplierReturn } from './return-ledger'
import { assertOperationDate } from '@/features/finance/access'
import { workshopDay } from '@/features/settlements/amounts'
import { revalidatePath } from 'next/cache'
import { onInventoryChanged } from '@/features/inventory/Lib/onInventoryChanged'

export async function createSupplierReturn(raw: unknown) {
  return withAuth(
    async (ctx) => {
      if (!receiptsEnabled(ctx.organizationId)) throw new Error('Надходження вимкнено.')
      await assertOperationDate(ctx, workshopDay())
      const id = await db.$transaction(async (tx) => {
        await lockFinance(tx, ctx.organizationId)
        await assertOperationDate(ctx, workshopDay())
        return postSupplierReturn(tx, ctx.organizationId, ctx.userId, raw)
      })
      await onInventoryChanged(ctx.organizationId)
      revalidatePath('/receipts')
      revalidatePath('/settlements')
      revalidatePath('/mutual-settlements')
      revalidatePath('/suppliers')
      revalidatePath('/vehicles')
      return id
    },
    {
      requiredPermissions: [
        { action: A.CREATE, subject: S.RECEIPTS },
        { action: A.UPDATE, subject: S.RECEIPTS },
        { action: A.CREATE, subject: S.SETTLEMENTS },
      ],
      audit: { action: 'receipts.return', entity: 'SupplierReturn' },
    }
  )
}

export async function supplierReturnData(receiptId: string) {
  return withAuth(
    async ({ organizationId }) => {
      if (!receiptsEnabled(organizationId)) throw new Error('Надходження вимкнено.')
      const r = await db.supplierReceipt.findFirstOrThrow({
        where: { id: receiptId, organizationId },
        include: {
          supplier: true,
          settlement: true,
          lines: {
            orderBy: { position: 'asc' },
            include: { returns: true, transfers: true },
          },
          returns: {
            orderBy: { createdAt: 'desc' },
            include: { lines: { include: { line: true } } },
          },
        },
      })
      return {
        supplier: r.supplier.name,
        enabled: r.status === 'posted' && !!r.settlement && !r.settlement.reversedAt,
        lines: r.lines.map((l) => ({
          id: l.id,
          name: l.name,
          unit: l.unit,
          unitPrice: l.unitPrice.toString(),
          available: l.quantity
            .minus(l.returns.reduce((n, v) => n + Number(v.quantity), 0))
            .minus(l.transfers.reduce((n, v) => n + Number(v.quantity), 0))
            .toString(),
        })),
        documents: r.returns.map((d) => ({
          id: d.id,
          number: d.number,
          date: d.date.toISOString().slice(0, 10),
          reason: d.reason,
          lines: d.lines.map((l) => ({
            name: l.line.name,
            unit: l.line.unit,
            quantity: l.quantity.toString(),
            amount: l.amount.toFixed(2),
          })),
        })),
      }
    },
    { requiredPermissions: [{ action: A.READ, subject: S.RECEIPTS }] }
  )
}
