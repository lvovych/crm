'use server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { withAuth, type AuthContext } from '@/lib/with-auth'
import { PermissionAction as A, PermissionSubject as S } from '@/lib/permissions'
import { Prisma } from '@/generated/prisma/client'
import { draftSchema, transitionReceipt } from './ledger'
import { onInventoryChanged } from '@/features/inventory/Lib/onInventoryChanged'

import { getCachedMembership } from '@/lib/cached-session'
import { receiptsEnabled } from './enabled'
function authorized<T>(action: A, fn: (ctx: AuthContext) => Promise<T>) {
  return withAuth(
    async (ctx) => {
      if (!receiptsEnabled(ctx.organizationId)) throw new Error('Надходження вимкнено.')
      return fn(ctx)
    },
    { requiredPermissions: [{ action, subject: S.RECEIPTS }] }
  )
}
export async function receiptAccess() {
  const result = await withAuth(async ({ userId, organizationId, isAdmin }) => {
    const member = await getCachedMembership(userId)
    const enabled = receiptsEnabled(organizationId)
    const can = (action: A) =>
      enabled &&
      (isAdmin ||
        !!member?.customRole?.permissions.some(
          (p) => p.subject === S.RECEIPTS && p.action === action
        ))
    return { read: can(A.READ), create: can(A.CREATE), post: can(A.UPDATE), cancel: can(A.DELETE) }
  })
  return result.data ?? { read: false, create: false, post: false, cancel: false }
}
export async function receiptOptions() {
  return authorized(A.CREATE, async ({ organizationId }) => ({
    suppliers: await db.counterparty.findMany({
      where: { organizationId, isArchived: false, supplierProfile: { isNot: null } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    parts: await db.inventoryPart.findMany({
      where: { organizationId, isArchived: false },
      select: {
        id: true,
        name: true,
        partNumber: true,
        barcode: true,
        unit: true,
        brand: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
    }),
  }))
}
export async function receiptList(
  q: string,
  status: string,
  supplierId: string,
  date: string,
  page: number
) {
  return authorized(A.READ, async ({ organizationId }) => {
    const where = {
      organizationId,
      ...(supplierId && { supplierId }),
      ...(date && { receivedDate: new Date(date + 'T00:00:00Z') }),
      ...(status && { status }),
      OR: [
        { number: { contains: q, mode: 'insensitive' as const } },
        { supplier: { name: { contains: q, mode: 'insensitive' as const } } },
      ],
    }
    const rows = await db.supplierReceipt.findMany({
      where,
      include: { supplier: { select: { name: true } }, lines: { select: { amount: true } } },
      orderBy: [{ receivedDate: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * 50,
      take: 51,
    })
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      supplier: r.supplier.name,
      status: r.status,
      documentDate: r.documentDate.toISOString().slice(0, 10),
      receivedDate: r.receivedDate.toISOString().slice(0, 10),
      total: r.lines.reduce((s, l) => s.plus(l.amount), new Prisma.Decimal(0)).toFixed(2),
    }))
  })
}
export async function receiptDetail(id: string) {
  return authorized(A.READ, async ({ organizationId }) => {
    const r = await db.supplierReceipt.findFirstOrThrow({
      where: { id, organizationId },
      include: { supplier: { select: { name: true } }, lines: { orderBy: { position: 'asc' } } },
    })
    const people = await db.user.findMany({
      where: {
        id: { in: [r.createdById, r.postedById, r.cancelledById].filter((x): x is string => !!x) },
      },
      select: { id: true, name: true },
    })
    const actor = (id: string | null) => people.find((p) => p.id === id)?.name ?? id
    return {
      ...r,
      creator: actor(r.createdById),
      poster: actor(r.postedById),
      canceller: actor(r.cancelledById),
      documentDate: r.documentDate.toISOString().slice(0, 10),
      receivedDate: r.receivedDate.toISOString().slice(0, 10),
      lines: r.lines.map((l) => ({
        ...l,
        quantity: l.quantity.toString(),
        unitPrice: l.unitPrice.toString(),
        amount: l.amount.toFixed(2),
      })),
    }
  })
}
export async function saveDraft(input: unknown) {
  return authorized(A.CREATE, async ({ organizationId, userId }) => {
    const d = draftSchema.parse(input)
    return db.$transaction(async (tx) => {
      const supplier = await tx.counterparty.findFirst({
        where: {
          id: d.supplierId,
          organizationId,
          isArchived: false,
          supplierProfile: { isNot: null },
        },
      })
      if (!supplier) throw new Error('Оберіть активного постачальника.')
      const fields = {
        supplierId: d.supplierId,
        number: d.number,
        documentDate: d.documentDate,
        receivedDate: d.receivedDate,
      }
      const existing = await tx.supplierReceipt.findFirst({
        where: {
          organizationId,
          supplierId: d.supplierId,
          number: d.number,
          documentDate: d.documentDate,
        },
      })
      if (existing && (existing.id !== d.id || d.version === 0))
        return { id: existing.id, duplicate: existing.id !== d.id }
      if (d.version === 0)
        await tx.supplierReceipt.create({
          data: { id: d.id, organizationId, createdById: userId, ...fields },
        })
      else {
        const changed = await tx.supplierReceipt.updateMany({
          where: { id: d.id, organizationId, version: d.version, status: 'draft' },
          data: { ...fields, version: { increment: 1 } },
        })
        if (!changed.count) throw new Error('Документ змінився. Оновіть сторінку.')
        await tx.supplierReceiptLine.deleteMany({ where: { receiptId: d.id } })
      }
      const parts = await tx.inventoryPart.findMany({
        where: {
          organizationId,
          isArchived: false,
          id: { in: d.lines.flatMap((l) => (l.partId ? [l.partId] : [])) },
        },
        select: { id: true, unit: true },
      })
      const lines = d.lines.map((line, position) => {
        const part = parts.find((p) => p.id === line.partId)
        if (line.kind === 'part' && line.partId && (!part || (part.unit || 'шт') !== line.unit))
          throw new Error('Оберіть складську картку з відповідною одиницею.')
        return {
          ...line,
          partId: line.kind === 'part' ? line.partId : null,
          receiptId: d.id,
          position,
          amount: new Prisma.Decimal(line.quantity)
            .times(line.unitPrice)
            .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
        }
      })
      await tx.supplierReceiptLine.createMany({ data: lines })
      return { id: d.id, duplicate: false }
    })
  })
}
export async function changeReceipt(
  id: string,
  version: number,
  target: 'posted' | 'cancelled',
  reason: string
) {
  if (
    typeof id !== 'string' ||
    !id ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    typeof reason !== 'string'
  )
    throw new Error('Некоректний документ або версія.')
  if (target !== 'posted' && target !== 'cancelled') throw new Error('Невідома дія')
  return authorized(
    target === 'posted' ? A.UPDATE : A.DELETE,
    async ({ organizationId, userId }) => {
      await db.$transaction((tx) =>
        transitionReceipt(tx, organizationId, userId, id, version, target, reason.slice(0, 1000))
      )
      await onInventoryChanged(organizationId)
      revalidatePath('/receipts')
      revalidatePath('/receipts/' + id)
      return true
    }
  )
}
