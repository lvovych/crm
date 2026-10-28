import 'server-only'
import { CronJob } from 'cron'
import { db } from '@/lib/db'
import { runLedgerDiagnostic } from './diagnostics'
import type { LedgerDB } from './transaction'
export function startLedgerDiagnosticWorker() {
  let running = false
  const job = new CronJob(
    '25 * * * *',
    async () => {
      if (running) return
      running = true
      try {
        const parties = await db.settlementParty.findMany({
            distinct: ['organizationId'],
            select: { organizationId: true },
          }),
          warehouses = await db.warehouse.findMany({
            distinct: ['organizationId'],
            select: { organizationId: true },
          })
        for (const organizationId of new Set(
          [...parties, ...warehouses].map((r) => r.organizationId)
        )) {
          const member = await db.organizationMember.findFirst({
            where: {
              organizationId,
              OR: [{ role: { in: ['owner', 'admin'] } }, { customRole: { isAdmin: true } }],
            },
            select: { userId: true },
          })
          if (!member) continue
          try {
            await runLedgerDiagnostic(db as unknown as LedgerDB, {
              organizationId,
              userId: member.userId,
            })
          } catch {
            console.error('[ledger] Daily reconciliation could not complete')
          }
        }
      } catch {
        console.error('[ledger] Reconciliation scheduling failed; retry on the next run')
      } finally {
        running = false
      }
    },
    null,
    false,
    'Europe/Kyiv'
  )
  job.start()
}
