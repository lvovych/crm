import { z } from 'zod'
import { supplierSchema } from '../Schema/supplierSchema'
export const normalizeTaxId = (value: string) => value.replace(/[\s-]/g, '').toUpperCase()
export const normalizeName = (value: string) =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase('uk')
    .replace(/[^\p{L}\p{N}]/gu, '')
const normalizePhone = (value: string) => value.replace(/\D/g, '')
const kinds = [
  'goods_receipt',
  'service_receipt',
  'goods_return',
  'service_return',
  'payment',
  'refund',
  'order',
  'opening_balance',
  'debt_adjustment',
] as const
export const supplierSnapshotSchema = z
  .object({
    version: z.literal(1),
    source: z.literal('carbook'),
    sourceAccountId: z.string().trim().min(1).max(100),
    periodStart: z.string().datetime({ offset: true }),
    snapshotAt: z.string().datetime({ offset: true }),
    // The exporter must state coverage explicitly. Partial evidence cannot certify exclusion.
    coverage: z.object({
      suppliers: z.boolean(),
      goods: z.boolean(),
      services: z.boolean(),
      returns: z.boolean(),
      payments: z.boolean(),
    }),
    suppliers: z
      .array(
        z.object({
          externalId: z.string().trim().min(1).max(100),
          data: supplierSchema,
          isArchived: z.boolean().default(false),
          hasOutstandingBalance: z.boolean().default(false),
        })
      )
      .max(2000),
    movements: z
      .array(
        z.object({
          externalId: z.string().min(1).max(100),
          supplierId: z.string().min(1).max(100),
          kind: z.enum(kinds),
          date: z.string().datetime({ offset: true }).nullable(),
          status: z.enum(['posted', 'draft', 'cancelled', 'deleted']),
          quantity: z.number().finite().optional(),
          amount: z.number().finite().optional(),
          technicalReversal: z.boolean().default(false),
        })
      )
      .max(250000),
  })
  .superRefine((v, ctx) => {
    if (Date.parse(v.periodStart) > Date.parse(v.snapshotAt))
      ctx.addIssue({ code: 'custom', message: 'Invalid period' })
    const docs = new Map<string, string>()
    for (const movement of v.movements) {
      if (movement.status === 'posted' && !movement.technicalReversal) {
        const goods = ['goods_receipt', 'goods_return'].includes(movement.kind)
        const money = ['service_receipt', 'service_return', 'payment', 'refund'].includes(
          movement.kind
        )
        if ((goods && movement.quantity === undefined) || (money && movement.amount === undefined))
          ctx.addIssue({
            code: 'custom',
            message: 'Missing movement amount or quantity: ' + movement.externalId,
          })
      }
      const key = movement.kind + ':' + movement.externalId
      const serialized = JSON.stringify(movement)
      if (docs.has(key) && docs.get(key) !== serialized)
        ctx.addIssue({
          code: 'custom',
          message: 'Conflicting versions of source operation: ' + key,
        })
      docs.set(key, serialized)
    }
    const ids = new Set<string>()
    for (const s of v.suppliers) {
      if (ids.has(s.externalId))
        ctx.addIssue({ code: 'custom', message: 'Duplicate source supplier ID: ' + s.externalId })
      ids.add(s.externalId)
    }
  })
export type SupplierSnapshot = z.infer<typeof supplierSnapshotSchema>
export type ExistingSupplier = {
  id: string
  name: string
  taxId: string | null
  contacts: { phone: string | null; email: string | null }[]
  sourceLinks: { source: string; sourceAccountId: string; externalSupplierId: string }[]
}
export function buildSupplierPreview(snapshot: SupplierSnapshot, existing: ExistingSupplier[]) {
  const start = Date.parse(snapshot.periodStart),
    end = Date.parse(snapshot.snapshotAt)
  const complete = Object.values(snapshot.coverage).every(Boolean)
  const supplierIds = new Set(snapshot.suppliers.map((s) => s.externalId))
  const orphanMovements = snapshot.movements
    .filter((m) => !supplierIds.has(m.supplierId))
    .map((m) => m.externalId)
  const seen = new Set<string>()
  const movements = snapshot.movements.filter((m) => {
    const key = m.kind + ':' + m.externalId
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const movementsBySupplier = new Map<string, typeof movements>()
  for (const m of movements) {
    const group = movementsBySupplier.get(m.supplierId) ?? []
    group.push(m)
    movementsBySupplier.set(m.supplierId, group)
  }
  const items = snapshot.suppliers.map((s) => {
    const own = movementsBySupplier.get(s.externalId) ?? []
    const evidence = own
      .filter(
        (m) =>
          m.status === 'posted' &&
          !m.technicalReversal &&
          m.date !== null &&
          Date.parse(m.date) >= start &&
          Date.parse(m.date) <= end &&
          (['goods_receipt', 'goods_return'].includes(m.kind)
            ? (m.quantity ?? 0) !== 0
            : ['service_receipt', 'service_return', 'payment', 'refund'].includes(m.kind) &&
              (m.amount ?? 0) !== 0)
      )
      .map((m) => ({ externalId: m.externalId, kind: m.kind, date: m.date! }))
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
    const unknownDates = own.some(
      (m) =>
        m.status === 'posted' &&
        !m.technicalReversal &&
        m.date === null &&
        !['order', 'opening_balance', 'debt_adjustment'].includes(m.kind)
    )
    const linked = existing.find((e) =>
      e.sourceLinks.some(
        (l) =>
          l.source === 'carbook' &&
          l.sourceAccountId === snapshot.sourceAccountId &&
          l.externalSupplierId === s.externalId
      )
    )
    const conflicts: { id: string; name: string; reason: string; source: 'crm' | 'carbook' }[] = []
    function compare(
      id: string,
      name: string,
      taxId: string | null,
      contacts: { phone: string | null; email: string | null }[],
      source: 'crm' | 'carbook'
    ) {
      const a = normalizeTaxId(s.data.taxId),
        b = normalizeTaxId(taxId ?? '')
      let reason = ''
      if (a && b && a === b) reason = 'taxId'
      else if (normalizeName(s.data.name) === normalizeName(name))
        reason = a && b && a !== b ? 'differentTaxId' : 'name'
      else if (
        s.data.contacts.some((c) =>
          contacts.some(
            (d) =>
              (c.phone &&
                d.phone &&
                normalizePhone(c.phone).length >= 7 &&
                normalizePhone(c.phone) === normalizePhone(d.phone)) ||
              (c.email && d.email && c.email.toLowerCase() === d.email.toLowerCase())
          )
        )
      )
        reason = 'contact'
      if (reason) conflicts.push({ id, name, reason, source })
    }
    for (const e of existing)
      if (e.id !== linked?.id) compare(e.id, e.name, e.taxId, e.contacts, 'crm')
    for (const other of snapshot.suppliers)
      if (other.externalId !== s.externalId)
        compare(other.externalId, other.data.name, other.data.taxId, other.data.contacts, 'carbook')
    const decision = linked
      ? 'alreadyLinked'
      : evidence.length
        ? conflicts.length
          ? 'review'
          : 'eligible'
        : unknownDates || !complete
          ? 'uncertain'
          : 'excluded'
    return {
      externalSupplierId: s.externalId,
      name: s.data.name,
      decision,
      existingId: linked?.id ?? null,
      isArchived: s.isArchived,
      hasOutstandingBalance: s.hasOutstandingBalance,
      evidence,
      conflicts,
      data: s.data,
    }
  })
  return {
    complete: complete && orphanMovements.length === 0,
    orphanMovements,
    items,
    summary: {
      total: items.length,
      eligible: items.filter((i) => i.decision === 'eligible').length,
      review: items.filter((i) => i.decision === 'review').length,
      excluded: items.filter((i) => i.decision === 'excluded').length,
      uncertain: items.filter((i) => i.decision === 'uncertain').length,
      alreadyLinked: items.filter((i) => i.decision === 'alreadyLinked').length,
    },
  }
}
