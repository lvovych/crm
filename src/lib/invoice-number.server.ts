import type { TxClient } from '@/lib/db'
import { zonedParts } from '@/lib/timezone'

/** Reserve in the same transaction that creates the invoice. All automatic writers share this lock. */
export async function nextInvoiceNumber(
  tx: TxClient,
  organizationId: string,
  timeZone: string,
  now = new Date()
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}), hashtext('invoice-number'))`
  const settings = await tx.appSetting.findMany({
    where: {
      organizationId,
      key: { in: ['workshop.invoicePrefix', 'workshop.invoiceStartNumber'] },
    },
  })
  const values = Object.fromEntries(settings.map((s) => [s.key, s.value]))
  const counter = await tx.invoiceCounter.findUnique({ where: { organizationId } })
  let last: bigint
  if (counter) last = BigInt(counter.lastNumber)
  else {
    // Bootstrap once from every historical number, including imported rows and prefixes.
    const [row] = await tx.$queryRaw<{ maximum: string | null }[]>`
      SELECT MAX(substring("invoiceNumber" from '([0-9]+)$')::numeric)::text AS maximum
      FROM "public"."service_records" WHERE "organizationId" = ${organizationId}`
    last = row?.maximum ? BigInt(row.maximum) : BigInt(0)
  }
  const start = /^\d+$/.test(values['workshop.invoiceStartNumber'] ?? '')
    ? BigInt(values['workshop.invoiceStartNumber'])
    : BigInt(0)
  let number = last + BigInt(1)
  if (!counter && start === BigInt(0) && number < BigInt(1001)) number = BigInt(1001)
  if (start > number) number = start
  const parts = zonedParts(now, timeZone)
  const prefix = (values['workshop.invoicePrefix'] ?? '{year}-')
    .replaceAll('{year}', String(parts.year))
    .replaceAll('{month}', String(parts.month).padStart(2, '0'))
  // A later manual edit or import can occupy a number after counter initialization.
  while (
    await tx.serviceRecord.findFirst({
      where: { organizationId, invoiceNumber: prefix + number },
      select: { id: true },
    })
  )
    number++
  await tx.invoiceCounter.upsert({
    where: { organizationId },
    create: { organizationId, lastNumber: String(number) },
    update: { lastNumber: String(number) },
  })
  if (start > 0)
    await tx.appSetting.updateMany({
      where: {
        organizationId,
        key: 'workshop.invoiceStartNumber',
        value: values['workshop.invoiceStartNumber'],
      },
      data: { value: '' },
    })
  return prefix + number
}
