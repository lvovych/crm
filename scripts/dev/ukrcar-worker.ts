/** Local-only worker: restored databases must never run other suppliers or scheduled messages. */
import 'dotenv/config'
import { db } from '../../src/lib/db'
import { runJob } from '../../src/features/integrations/Lib/jobs'
import { RECEIPT_IMPORT_JOB } from '../../src/features/receipts/import-service'

async function main() {
  const url = new URL(process.env.DATABASE_URL || '')
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || process.env.DISABLE_BACKGROUND_JOBS !== '1') {
    throw new Error('This worker requires a local database and DISABLE_BACKGROUND_JOBS=1.')
  }
  console.info('Local UkrCar worker started. Only manually queued receipt imports will run.')
  for (;;) {
    const cutoff = new Date(Date.now() - 10 * 60_000)
    await db.integrationJob.updateMany({
      where: { kind: RECEIPT_IMPORT_JOB, connection: { connectorId: 'ukrcar' }, status: 'running', lockedAt: { lt: cutoff } },
      data: { status: 'queued', lockedAt: null, runAfter: new Date() },
    })
    const jobs = await db.integrationJob.findMany({
      where: { kind: RECEIPT_IMPORT_JOB, connection: { connectorId: 'ukrcar', status: { in: ['active', 'error'] } }, status: 'queued', runAfter: { lte: new Date() } },
      select: { id: true }, take: 5, orderBy: { createdAt: 'asc' },
    })
    for (const job of jobs) await runJob(job.id)
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => db.$disconnect())
