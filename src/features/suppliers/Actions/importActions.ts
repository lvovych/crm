'use server'
import { createHash } from 'node:crypto'
import { assertSupplierDirectoryEnabled } from '../Lib/enabled'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { PermissionAction as A, PermissionSubject as S } from '@/lib/permissions'
import { supplierSnapshotSchema, buildSupplierPreview } from '../Lib/preview'
import { zonedParts, zonedDate } from '@/lib/timezone'
import { workshopTimeZone } from '@/lib/workshop-timezone'
// Staging only. Approval is recorded separately; execution requires a validated plan.
export async function previewSupplierImport(raw: string) {
  return withAuth(
    async ({ organizationId, userId }) => {
      assertSupplierDirectoryEnabled(organizationId)
      if (typeof raw !== 'string' || Buffer.byteLength(raw) > 8 * 1024 * 1024)
        throw new Error('Snapshot must be at most 8 MiB')
      const snapshot = supplierSnapshotSchema.parse(JSON.parse(raw))
      const tz = await workshopTimeZone(organizationId)
      const p = zonedParts(new Date(snapshot.snapshotAt), tz)
      const cutoff = zonedDate(p.year - 3, p.month, p.day, 0, 0, tz)
      if (new Date(snapshot.periodStart).getTime() !== cutoff.getTime())
        throw new Error('Period must start at local midnight exactly three years before snapshot')
      if (Date.parse(snapshot.snapshotAt) > Date.now() + 60000)
        throw new Error('Snapshot cannot be in the future')
      const existing = await db.counterparty.findMany({
        where: { organizationId, supplierProfile: { isNot: null } },
        include: { contacts: true, sourceLinks: true },
      })
      const preview = buildSupplierPreview(snapshot, existing)
      const checksum = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
      const runKey = { organizationId, sourceAccountId: snapshot.sourceAccountId, checksum }
      const previousRun = await db.supplierImportRun.findUnique({
        where: { organizationId_sourceAccountId_checksum: runKey },
      })
      // Re-preview must never replace the evidence of an executed import.
      if (previousRun && previousRun.status !== 'preview')
        return {
          ...preview,
          runId: previousRun.id,
          periodStart: snapshot.periodStart,
          snapshotAt: snapshot.snapshotAt,
        }
      const assessedItems = preview.items.map((i) => ({
        organizationId,
        externalSupplierId: i.externalSupplierId,
        decision: i.decision,
        payload: JSON.parse(
          JSON.stringify({
            data: i.data,
            isArchived: i.isArchived,
            hasOutstandingBalance: i.hasOutstandingBalance,
            existingId: i.existingId,
          })
        ),
        evidence: i.evidence,
        conflicts: i.conflicts,
      }))
      const summary = {
        ...preview.summary,
        complete: preview.complete,
        coverage: snapshot.coverage,
        orphanMovements: preview.orphanMovements,
      }
      // A preview writes staging rows only, never counterparties, inventory or balances.
      const run = await db.supplierImportRun.upsert({
        where: {
          organizationId_sourceAccountId_checksum: runKey,
          // A concurrent apply can win after the read above. In that case the
          // unique constraint rejects creation instead of rewriting its history.
          status: 'preview',
        },
        create: {
          organizationId,
          sourceAccountId: snapshot.sourceAccountId,
          periodStart: new Date(snapshot.periodStart),
          snapshotAt: new Date(snapshot.snapshotAt),
          checksum,
          createdById: userId,
          summary,
          items: { create: assessedItems },
        },
        update: { summary, items: { deleteMany: {}, create: assessedItems } },
      })
      return {
        ...preview,
        runId: run.id,
        periodStart: snapshot.periodStart,
        snapshotAt: snapshot.snapshotAt,
      }
    },
    {
      requiredPermissions: [
        { action: A.MANAGE, subject: S.SUPPLIERS },
        { action: A.READ, subject: S.SUPPLIERS },
      ],
      audit: ({ result }) => ({
        action: 'supplier.import.preview',
        entity: 'SupplierImportRun',
        entityId: result.runId,
      }),
    }
  )
}
