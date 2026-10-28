import 'server-only'
import { CronJob } from 'cron'
import { db } from '@/lib/db'
import type { PrismaClient } from '@/generated/prisma/client'
import { runImportTasks } from './importQueue'
export function startLedgerImportWorker() {
  let running = false
  const job = new CronJob('* * * * *', async () => {
    if (running) return
    running = true
    try {
      await runImportTasks(db as unknown as PrismaClient)
    } catch {
      console.error('[ledger] Import queue could not be processed')
    } finally {
      running = false
    }
  })
  job.start()
}
