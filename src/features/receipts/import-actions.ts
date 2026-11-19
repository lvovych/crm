'use server'

import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { PermissionAction as A, PermissionSubject as S } from '@/lib/permissions'
import { getFeatures } from '@/lib/features'
import { demoGuard } from '@/lib/demo'
import { connectorAllowed } from '@/features/integrations/Lib/plan'
import { manifest } from '@/integrations/ukrcar/manifest'
import { importPeriod } from '@/integrations/ukrcar/parser'
import { receiptsEnabled } from './enabled'
import { queueReceiptImport, RECEIPT_IMPORT_JOB } from './import-service'

const permissions = [
  { action: A.READ, subject: S.RECEIPTS },
  { action: A.CREATE, subject: S.RECEIPTS },
]

export async function startReceiptImport() {
  return withAuth(
    async ({ organizationId, userId }) => {
      demoGuard()
      if (!receiptsEnabled(organizationId)) throw new Error('Надходження вимкнено.')
      if (!connectorAllowed(manifest, await getFeatures(organizationId)))
        throw new Error('Інтеграції недоступні у вашому тарифі.')
      const connection = await db.integrationConnection.findUnique({
        where: { organizationId_connectorId: { organizationId, connectorId: 'ukrcar' } },
      })
      if (!connection || !['active', 'error'].includes(connection.status))
        throw new Error('Підключіть Укркар у налаштуваннях інтеграцій.')
      const settings = connection.settings as Record<string, unknown>
      if (
        typeof settings.supplierId !== 'string' ||
        !(await db.counterparty.count({
          where: {
            id: settings.supplierId,
            organizationId,
            isArchived: false,
            supplierProfile: { isNot: null },
          },
        }))
      )
        throw new Error('Оберіть активного постачальника в налаштуваннях Укркар.')
      return {
        jobId: await queueReceiptImport(connection.id, organizationId, userId, importPeriod()),
      }
    },
    { requiredPermissions: permissions }
  )
}

export async function receiptImportStatus() {
  return withAuth(
    async ({ organizationId }) => {
      if (!receiptsEnabled(organizationId)) throw new Error('Надходження вимкнено.')
      const connection = await db.integrationConnection.findUnique({
        where: { organizationId_connectorId: { organizationId, connectorId: 'ukrcar' } },
        select: { id: true, status: true, settings: true, state: true },
      })
      if (!connection) return { configured: false, job: null, progress: null }
      const job = await db.integrationJob.findFirst({
        where: { connectionId: connection.id, organizationId, kind: RECEIPT_IMPORT_JOB },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true, error: true, attempts: true, payload: true },
      })
      const settings = connection.settings as Record<string, unknown>
      const state = connection.state as Record<string, unknown>
      const progress = state.receiptImport as
        | { runId?: string; created?: number; skipped?: number; processed?: number }
        | undefined
      const payload = job?.payload as { runId?: string } | undefined
      return {
        configured:
          ['active', 'error'].includes(connection.status) &&
          typeof settings.supplierId === 'string' &&
          !!settings.supplierId,
        job: job
          ? { id: job.id, status: job.status, error: job.error, attempts: job.attempts }
          : null,
        progress:
          progress?.runId && progress.runId === payload?.runId
            ? {
                created: progress.created || 0,
                skipped: progress.skipped || 0,
                processed: progress.processed || 0,
              }
            : null,
      }
    },
    { requiredPermissions: permissions }
  )
}
