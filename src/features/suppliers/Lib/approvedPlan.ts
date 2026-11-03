import { createHash } from 'node:crypto'
import { z } from 'zod'
import { buildSupplierPreview, supplierSnapshotSchema, type ExistingSupplier } from './preview'

const identity = z.string().trim().min(1).max(200)
export const supplierApprovalSchema = z
  .object({
    version: z.literal(1),
    source: z.literal('carbook'),
    sourceAccountId: identity,
    periodStart: z.string().datetime({ offset: true }),
    reviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    activeOnly: z.literal(true),
    duplicatePolicy: z.literal('keep_separate'),
    approvedSuppliers: z
      .array(z.object({ externalId: identity, name: identity }))
      .min(1)
      .max(2000),
    excludedSupplierIds: z.array(identity),
  })
  .superRefine((v, ctx) => {
    const ids = v.approvedSuppliers.map((s) => s.externalId)
    if (new Set(ids).size !== ids.length || ids.some((id) => v.excludedSupplierIds.includes(id)))
      ctx.addIssue({ code: 'custom', message: 'Approval contains duplicate or excluded IDs' })
  })

const checksum = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** Read-only preparation. A plan is not an authorization token or a database mutation. */
export function prepareApprovedSupplierPlan(
  rawSnapshot: unknown,
  rawApproval: unknown,
  organizationId: string,
  existing: ExistingSupplier[] = []
) {
  if (!organizationId.trim()) throw new Error('Target organization is required')
  const snapshot = supplierSnapshotSchema.parse(rawSnapshot)
  const approval = supplierApprovalSchema.parse(rawApproval)
  if (
    snapshot.sourceAccountId !== approval.sourceAccountId ||
    Date.parse(snapshot.periodStart) !== Date.parse(approval.periodStart)
  )
    throw new Error('Source account or approved period mismatch')
  const preview = buildSupplierPreview(snapshot, existing)
  const approved = new Map(approval.approvedSuppliers.map((s) => [s.externalId, s]))
  const items = preview.items.filter((s) => approved.has(s.externalSupplierId))
  if (items.length !== approved.size) throw new Error('Snapshot is missing approved suppliers')
  const blockers: string[] = []
  if (preview.orphanMovements.length) blockers.push('Snapshot contains orphan movements')
  for (const item of items) {
    const id = item.externalSupplierId
    if (item.name !== approved.get(id)!.name) blockers.push(`${id}: name changed since approval`)
    if (item.isArchived) blockers.push(`${id}: supplier is inactive`)
    if (!item.evidence.length) blockers.push(`${id}: no qualifying movement evidence`)
    if (item.conflicts.some((c) => c.source === 'crm'))
      blockers.push(
        `${id}: CRM conflict requires review; source duplicate approval does not cover CRM`
      )
    const links = existing.filter((e) =>
      e.sourceLinks.some(
        (l) =>
          l.source === 'carbook' &&
          l.sourceAccountId === snapshot.sourceAccountId &&
          l.externalSupplierId === id
      )
    )
    if (links.length > 1) blockers.push(`${id}: ambiguous existing source mapping`)
  }
  const targets = items.filter((i) => i.existingId).map((i) => i.existingId)
  if (new Set(targets).size !== targets.length)
    blockers.push('Separate source cards already map to the same CRM supplier')
  return {
    version: 1,
    mode: 'prepare_only',
    organizationId,
    sourceAccountId: snapshot.sourceAccountId,
    snapshotChecksum: checksum(snapshot),
    approvalChecksum: checksum(approval),
    ready: blockers.length === 0,
    blockers,
    // Positive evidence is sufficient for an explicitly approved subset. No claim
    // about excluded cards or complete historical coverage is made here.
    sourceCoverageComplete: preview.complete,
    summary: {
      approved: approved.size,
      create: items.filter((i) => !i.existingId).length,
      alreadyLinked: items.filter((i) => i.existingId).length,
    },
    items: items.map((i) => ({
      externalSupplierId: i.externalSupplierId,
      action: i.existingId ? 'skip_existing' : 'create_separate',
      existingId: i.existingId,
      data: i.data,
      evidence: i.evidence,
      conflicts: i.conflicts,
    })),
  }
}
