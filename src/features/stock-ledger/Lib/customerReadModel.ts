import { Prisma } from '@/generated/prisma/client'
import { D } from './amounts'
import type { LedgerDB } from './transaction'
/** Read projection only. Never creates Payment rows or cash movements. */
export async function readLedgerCustomerTotals(
  db: LedgerDB,
  organizationId: string,
  ids: string[]
) {
  const result = new Map<string, { total: string; paid: string; debt: string }>()
  if (!ids.length) return result
  for (let start = 0; start < ids.length; start += 1000) {
    const batch = ids.slice(start, start + 1000)
    const rows = await db.$transaction(
      (tx) =>
        tx.$queryRaw<
          { id: string; total: string; debt: string }[]
        >`SELECT "serviceRecordId" AS id,total::text,debt::text FROM "public"."ledger_customer_balances" WHERE "organizationId"=${organizationId} AND "serviceRecordId" IN (${Prisma.join(batch)})`
    )
    for (const row of rows)
      result.set(row.id, {
        total: D(row.total).toFixed(2),
        paid: D(row.total).minus(row.debt).toFixed(2),
        debt: D(row.debt).toFixed(2),
      })
  }
  return result
}
