import { CronJob } from 'cron'
import { db } from '@/lib/db'
import { executeRecurringInvoice } from '@/features/billing/Lib/recurringExecution'
export { calculateNextRunDate } from '@/features/billing/Lib/recurringExecution'

export function processRecurringInvoices() {
  const job = new CronJob('0 * * * *', async () => {
    try {
      const now = new Date()
      const due = await db.recurringInvoice.findMany({
        where: { isActive: true, nextRunDate: { lte: now } },
        select: { id: true, nextRunDate: true, vehicle: { select: { organizationId: true } } },
      })
      let processed = 0
      for (const ri of due) {
        if (!ri.vehicle.organizationId) continue
        try {
          if (await executeRecurringInvoice(ri, ri.vehicle.organizationId, now)) processed++
        } catch (error) {
          console.error(`[cron] Failed to process recurring invoice ${ri.id}:`, error)
        }
      }
      if (processed) console.warn(`[cron] Processed ${processed} recurring invoices`)
    } catch (error) {
      console.error('[cron] Recurring invoice processing failed:', error)
    }
  })
  job.start()
}
