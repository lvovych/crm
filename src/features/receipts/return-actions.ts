'use server'
import { Prisma } from '@/generated/prisma/client'
import { returnDocumentInclude, serializeReturn } from './return-document'
import { lockFinance } from '@/features/finance/ledger'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { PermissionAction as A, PermissionSubject as S } from '@/lib/permissions'
import { currentTransferred } from './return-availability'
import { availableQuantity } from './transfer-schema'
import { receiptsEnabled } from './enabled'
import { postSupplierReturn } from './return-ledger'
import { assertOperationDate } from '@/features/finance/access'
import { zonedDayKey } from '@/lib/timezone'
import { workshopTimeZone } from '@/lib/workshop-timezone'
import { revalidatePath } from 'next/cache'
import { onInventoryChanged } from '@/features/inventory/Lib/onInventoryChanged'

export async function createSupplierReturn(raw: unknown) {
  return withAuth(
    async (ctx) => {
      if (!receiptsEnabled(ctx.organizationId)) throw new Error('Надходження вимкнено.')
      const today = zonedDayKey(new Date(), await workshopTimeZone(ctx.organizationId))
      await assertOperationDate(ctx, today)
      const id = await db.$transaction(async (tx) => {
        await lockFinance(tx, ctx.organizationId)
        await assertOperationDate(ctx, today)
        return postSupplierReturn(tx, ctx.organizationId, ctx.userId, raw, today, 'draft')
      })
      revalidatePath('/receipts')
      revalidatePath('/supplier-returns')
      revalidatePath('/documents')
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
            include: {
              returns: { where: { document: { status: 'posted' } } },
              transfers: true,
              part: { include: { brand: true } },
            },
          },
        },
      })
      const documents = await db.supplierReturn.findMany({
        where: {
          organizationId,
          OR: [{ receiptId }, { lines: { some: { line: { receiptId } } } }],
        },
        orderBy: { createdAt: 'desc' },
        include: returnDocumentInclude,
      })
      const transferred = await currentTransferred(db, organizationId, r.lines)
      return {
        supplier: r.supplier.name,
        supplierId: r.supplierId,
        enabled: r.status === 'posted' && !!r.settlement && !r.settlement.reversedAt,
        lines: r.lines.map((l) => ({
          id: l.id,
          name: l.name,
          brand: l.part?.brand.name ?? '',
          article: l.article || l.part?.partNumber || '',
          unit: l.unit,
          unitPrice: l.unitPrice.toString(),
          available: availableQuantity(l.quantity.toString(), [
            ...l.returns.map((item) => item.quantity.toString()),
            transferred.get(l.id)!.toString(),
          ]),
        })),
        documents: documents.map(serializeReturn),
      }
    },
    { requiredPermissions: [{ action: A.READ, subject: S.RECEIPTS }] }
  )
}

export async function supplierReturnDetail(id: string) {
  return withAuth(
    async ({ organizationId }) => {
      if (!receiptsEnabled(organizationId)) throw new Error('Надходження вимкнено.')
      const document = await db.supplierReturn.findFirst({
        where: { id, organizationId },
        include: returnDocumentInclude,
      })
      return document ? serializeReturn(document) : null
    },
    { requiredPermissions: [{ action: A.READ, subject: S.RECEIPTS }] }
  )
}
export async function supplierReturnOptions(supplierId: string, includeLineIds: string[] = []) {
  return withAuth(
    async (ctx) => {
      if (!receiptsEnabled(ctx.organizationId)) throw new Error('Надходження вимкнено.')
      const supplier = await db.counterparty.findFirstOrThrow({
        where: { id: supplierId, organizationId: ctx.organizationId },
      })
      const today = zonedDayKey(new Date(), await workshopTimeZone(ctx.organizationId))
      const date = new Date(today + 'T00:00:00Z')
      const receipts = await db.supplierReceipt.findMany({
        where: {
          organizationId: ctx.organizationId,
          supplierId,
          status: 'posted',
          receivedDate: { lte: date },
          settlement: { is: { reversedAt: null, date: { lte: date } } },
        },
        orderBy: [{ receivedDate: 'desc' }, { id: 'asc' }],
        include: {
          lines: {
            orderBy: { position: 'asc' },
            include: {
              returns: { where: { document: { status: 'posted' } } },
              transfers: true,
              part: { include: { brand: true } },
            },
          },
        },
      })
      const transferred = await currentTransferred(
        db,
        ctx.organizationId,
        receipts.flatMap((r) => r.lines)
      )
      const lines = receipts
        .flatMap((r) =>
          r.lines.map((l) => {
            const available = availableQuantity(l.quantity.toString(), [
              ...l.returns.map((x) => x.quantity.toString()),
              transferred.get(l.id)!.toString(),
            ])
            const stock = l.kind === 'part' ? Math.max(0, l.part?.quantity ?? 0) : Number(available)
            return {
              id: l.id,
              name: l.name,
              brand: l.part?.brand.name ?? '',
              article: l.article || l.part?.partNumber || '',
              kind: l.kind,
              receiptId: r.id,
              receiptNumber: r.number,
              receiptDate: r.documentDate.toISOString().slice(0, 10),
              unit: l.unit,
              unitPrice: l.unitPrice.toString(),
              originalQuantity: l.quantity.toString(),
              originalAmount: l.amount.toFixed(2),
              returnedQuantity: l.returns
                .reduce((sum, r) => sum.plus(r.quantity), new Prisma.Decimal(0))
                .toString(),
              returnedAmount: l.returns
                .reduce((sum, r) => sum.plus(r.amount), new Prisma.Decimal(0))
                .toFixed(2),
              available: Math.min(Number(available), stock).toFixed(3),
            }
          })
        )
        .filter((l) => Number(l.available) > 0 || includeLineIds.includes(l.id))
      return { supplierId, supplier: supplier.name, lines }
    },
    {
      requiredPermissions: [
        { action: A.READ, subject: S.RECEIPTS },
        { action: A.CREATE, subject: S.RECEIPTS },
        { action: A.UPDATE, subject: S.RECEIPTS },
        { action: A.CREATE, subject: S.SETTLEMENTS },
      ],
    }
  )
}

export async function completeSupplierReturn(id: string, version: number) {
  return withAuth(
    async (ctx) => {
      if (!receiptsEnabled(ctx.organizationId)) throw new Error('Надходження вимкнено.')
      const today = zonedDayKey(new Date(), await workshopTimeZone(ctx.organizationId))
      const result = await db.$transaction(async (tx) => {
        await lockFinance(tx, ctx.organizationId)
        await assertOperationDate(ctx, today)
        const d = await tx.supplierReturn.findFirstOrThrow({
          where: { id, organizationId: ctx.organizationId },
          include: { lines: true },
        })
        if (d.status === 'posted') return d.id
        if (d.version !== version) throw new Error('Документ уже змінено. Оновіть сторінку.')
        return postSupplierReturn(
          tx,
          ctx.organizationId,
          ctx.userId,
          {
            id,
            version,
            ...(d.receiptId ? { receiptId: d.receiptId } : { supplierId: d.supplierId }),
            reason: d.reason,
            supplierDocumentNumber: d.supplierDocumentNumber ?? undefined,
            lines: d.lines.map((l) => ({ id: l.lineId, quantity: l.quantity.toString() })),
          },
          today
        )
      })
      await onInventoryChanged(ctx.organizationId)
      for (const path of [
        '/supplier-returns',
        '/receipts',
        '/documents',
        '/suppliers',
        '/settlements',
        '/mutual-settlements',
      ])
        revalidatePath(path, 'layout')
      return result
    },
    {
      requiredPermissions: [
        { action: A.UPDATE, subject: S.RECEIPTS },
        { action: A.CREATE, subject: S.SETTLEMENTS },
      ],
      audit: { action: 'receipts.return.post', entity: 'SupplierReturn' },
    }
  )
}

export async function listSupplierReturns(
  filters: { supplier?: string; status?: string; q?: string; from?: string; to?: string } = {}
) {
  return withAuth(
    async ({ organizationId }) => {
      if (!receiptsEnabled(organizationId)) throw new Error('Надходження вимкнено.')
      const where: Prisma.SupplierReturnWhereInput = { organizationId }
      if (filters.supplier) where.supplierId = filters.supplier
      if (['draft', 'posted'].includes(filters.status || '')) where.status = filters.status
      if (filters.q)
        where.OR = [
          { supplierDocumentNumber: { contains: filters.q.slice(0, 120), mode: 'insensitive' } },
          { number: { contains: filters.q.slice(0, 120), mode: 'insensitive' } },
          { supplier: { name: { contains: filters.q.slice(0, 120), mode: 'insensitive' } } },
        ]
      const validDate = (s?: string) =>
        s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))
          ? new Date(s + 'T00:00:00Z')
          : undefined
      if (validDate(filters.from) || validDate(filters.to))
        where.date = { gte: validDate(filters.from), lte: validDate(filters.to) }
      const [documents, suppliers] = await Promise.all([
        db.supplierReturn.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          include: returnDocumentInclude,
        }),
        db.counterparty.findMany({
          where: { organizationId, returns: { some: {} } },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
      ])
      return { documents: documents.map(serializeReturn), suppliers }
    },
    { requiredPermissions: [{ action: A.READ, subject: S.RECEIPTS }] }
  )
}
