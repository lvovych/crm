'use server'

import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { PermissionAction as A, PermissionSubject as S } from '@/lib/permissions'
import { getFeatures } from '@/lib/features'
import { demoGuard } from '@/lib/demo'
import { connectorAllowed } from '@/features/integrations/Lib/plan'
import { listManifests } from '@/integrations/registry'
import { importPeriod } from './import-types'
import { receiptsEnabled } from './enabled'
import { queueReceiptImport, RECEIPT_IMPORT_JOB } from './import-service'

const permissions = [
  { action: A.READ, subject: S.RECEIPTS },
  { action: A.CREATE, subject: S.RECEIPTS },
]

async function importConnections(organizationId: string) {
  if (!receiptsEnabled(organizationId)) throw new Error('Надходження вимкнено.')
  const features = await getFeatures(organizationId)
  const manifests = listManifests().filter(
    (m) => m.capabilities.includes('supplier.receipts') && connectorAllowed(m, features)
  )
  const rows = await db.integrationConnection.findMany({
    where: {
      organizationId,
      connectorId: { in: manifests.map((m) => m.id) },
      status: { in: ['active', 'error'] },
    },
    select: { id: true, connectorId: true, settings: true, state: true },
    orderBy: { connectorId: 'asc' },
  })
  return Promise.all(
    rows.map(async (connection) => {
      const settings = connection.settings as Record<string, unknown>
      const configured =
        typeof settings.supplierId === 'string' &&
        !!(await db.counterparty.count({
          where: {
            id: settings.supplierId,
            organizationId,
            isArchived: false,
            supplierProfile: { isNot: null },
          },
        }))
      return {
        ...connection,
        configured,
        name: manifests.find((m) => m.id === connection.connectorId)!.name,
      }
    })
  )
}

export async function startReceiptImport() {
  return withAuth(
    async ({ organizationId, userId }) => {
      demoGuard()
      const connections = await importConnections(organizationId)
      const period = importPeriod()
      // Independent queues: one failed connection must not undo another supplier's job.
      const results = await Promise.all(
        connections.map(async (connection) => {
          try {
            if (!connection.configured)
              throw new Error('Оберіть активного постачальника в налаштуваннях інтеграції.')
            const jobId = await queueReceiptImport(connection.id, organizationId, userId, period)
            return { connectorId: connection.connectorId, jobId, error: null }
          } catch {
            return {
              connectorId: connection.connectorId,
              jobId: null,
              error: `${connection.name}: не вдалося запустити імпорт. Перевірте налаштування постачальника.`,
            }
          }
        })
      )
      if (!results.length) throw new Error('Підключіть постачальника в налаштуваннях інтеграцій.')
      return { results }
    },
    { requiredPermissions: permissions }
  )
}

export async function receiptImportStatus() {
  return withAuth(
    async ({ organizationId }) => {
      const connections = await importConnections(organizationId)
      const suppliers = await Promise.all(
        connections.map(async (connection) => {
          const job = await db.integrationJob.findFirst({
            where: { connectionId: connection.id, organizationId, kind: RECEIPT_IMPORT_JOB },
            orderBy: { createdAt: 'desc' },
            select: { id: true, status: true, error: true, attempts: true, payload: true },
          })
          const state = connection.state as Record<string, unknown>
          const progress = state.receiptImport as
            | { runId?: string; created?: number; skipped?: number; processed?: number }
            | undefined
          const payload = job?.payload as { runId?: string } | undefined
          return {
            connectorId: connection.connectorId,
            name: connection.name,
            configured: connection.configured,
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
        })
      )
      return { configured: suppliers.some((s) => s.configured), suppliers }
    },
    { requiredPermissions: permissions }
  )
}
