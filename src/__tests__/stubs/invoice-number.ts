import { db } from '@/lib/db'
import { zonedParts } from '@/lib/timezone'
export async function actionTestInvoiceNumber(_tx: unknown, organizationId: string, zone: string) {
  const settings = Object.fromEntries(
    (await db.appSetting.findMany({ where: { organizationId } })).map((s) => [s.key, s.value])
  )
  const previous = await db.serviceRecord.findFirst({ where: { organizationId } })
  const start = Number(settings['workshop.invoiceStartNumber']) || 0
  const next = Math.max(
    start,
    previous?.invoiceNumber ? Number(previous.invoiceNumber.match(/(\d+)$/)?.[1] ?? 1000) + 1 : 1001
  )
  if (start && next === start)
    await db.appSetting.updateMany({
      where: { organizationId, key: 'workshop.invoiceStartNumber' },
      data: { value: '' },
    })
  const date = zonedParts(new Date(), zone)
  return (
    (settings['workshop.invoicePrefix'] ?? '{year}-')
      .replace('{year}', String(date.year))
      .replace('{month}', String(date.month).padStart(2, '0')) + next
  )
}
