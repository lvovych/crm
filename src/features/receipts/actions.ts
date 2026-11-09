'use server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { withAuth, type AuthContext } from '@/lib/with-auth'
import { PermissionAction as A, PermissionSubject as S } from '@/lib/permissions'
import { receiptTotal } from './money'
import { transitionReceipt } from './ledger'
import { saveReceiptDraft } from './save-ledger'
import { onInventoryChanged } from '@/features/inventory/Lib/onInventoryChanged'

import { settlementAccess } from '@/features/settlements/actions'
import { day, hryvnia, kopecks, remaining, workshopDay } from '@/features/settlements/amounts'
import { getCachedMembership } from '@/lib/cached-session'
import { receiptsEnabled } from './enabled'
function authorized<T>(action: A | A[], fn: (ctx: AuthContext) => Promise<T>) {
  return withAuth(
    async (ctx) => {
      if (!receiptsEnabled(ctx.organizationId)) throw new Error('Надходження вимкнено.')
      return fn(ctx)
    },
    { requiredPermissions: [action].flat().map((a) => ({ action: a, subject: S.RECEIPTS })) }
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
    brands: await db.brand.findMany({
      select: { id: true, name: true, isActive: true },
      orderBy: { name: 'asc' },
    }),
    parts: await db.inventoryPart.findMany({
      where: { organizationId, isArchived: false },
      select: {
        id: true,
        name: true,
        supplierArticles: { select: { supplierId: true, normalized: true } },
        partNumber: true,
        barcode: true,
        brandId: true,
        unitCost: true,
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
  page: number,
  paymentFilter = ''
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
    const visible = (await settlementAccess()).read
    const filter = visible ? paymentFilter : ''
    const rows = await db.supplierReceipt.findMany({
      where,
      include: {
        settlement: { include: { debits: true } },
        supplier: { select: { name: true } },
        lines: { select: { amount: true } },
      },
      orderBy: [{ receivedDate: 'desc' }, { id: 'desc' }],
      ...(filter ? {} : { skip: (page - 1) * 50, take: 51 }),
    })
    const result = rows.map((r) => {
      const entry = visible ? r.settlement : null
      const open = entry ? remaining(entry, entry.debits, workshopDay()) : null
      const total = receiptTotal(r.lines)
      const paid = open === null ? null : kopecks(total) - open
      const state =
        r.status !== 'posted'
          ? ''
          : !entry
            ? 'unverified'
            : open === BigInt(0)
              ? 'paid'
              : paid === BigInt(0)
                ? 'unpaid'
                : 'partial'
      return {
        supplierId: r.supplierId,
        state,
        open: open === null ? null : hryvnia(open),
        paid: paid === null ? null : hryvnia(paid),
        due: entry?.due ? day(entry.due) : null,
        late:
          r.status === 'posted' &&
          open !== null &&
          open > 0 &&
          !!entry?.due &&
          day(entry.due) < workshopDay(),
        id: r.id,
        number: r.number,
        supplier: r.supplier.name,
        status: r.status,
        version: r.version,
        documentDate: r.documentDate.toISOString().slice(0, 10),
        receivedDate: r.receivedDate.toISOString().slice(0, 10),
        total,
      }
    })
    return filter
      ? result
          .filter((r) => (filter === 'late' ? r.late : r.state === filter))
          .slice((page - 1) * 50, page * 50 + 1)
      : result
  })
}
export async function receiptDetail(id: string) {
  return authorized(A.READ, async ({ organizationId }) => {
    const r = await db.supplierReceipt.findFirstOrThrow({
      where: { id, organizationId },
      include: {
        supplier: { select: { name: true } },
        lines: {
          orderBy: { position: 'asc' },
          include: { part: { select: { brand: { select: { name: true } } } } },
        },
      },
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
export async function saveDraft(input: unknown, post = false) {
  return authorized(
    post ? [A.CREATE, A.UPDATE] : A.CREATE,
    async ({ organizationId, userId, isAdmin }) => {
      const membership = await getCachedMembership(userId)
      const canCreatePart =
        isAdmin ||
        !!membership?.customRole?.permissions.some(
          (p) => p.subject === S.INVENTORY && p.action === A.CREATE
        )
      const result = await db.$transaction(
        (tx) => saveReceiptDraft(tx, organizationId, userId, input, post, canCreatePart),
        { timeout: 30000 }
      )
      if (post && !result.duplicate) await onInventoryChanged(organizationId)
      revalidatePath('/receipts')
      revalidatePath('/inventory')
      return result
    }
  )
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
