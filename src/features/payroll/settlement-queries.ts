import type { TxClient } from '@/lib/db'
import { z } from 'zod'
export function settlementPeriod(today: string, from?: string, to?: string) {
  const end = z
    .string()
    .date()
    .parse(to ?? today)
  const start = z
    .string()
    .date()
    .parse(from ?? new Date(new Date(end).getTime() - 89 * 86400000).toISOString().slice(0, 10))
  const days = (+new Date(end) - +new Date(start)) / 86400000
  if (days < 0 || days > 366) throw new Error('Оберіть період до одного року.')
  return { from: start, to: end }
}
/** All-time balances without loading payslip JSON or payment allocations. */
export async function staffBalances(tx: TxClient, organizationId: string) {
  return tx.$queryRaw<{ id: string; name: string; balance: string }[]>`
    SELECT t.id, t.name, (COALESCE(earned.total,0)-COALESCE(paid.total,0))::text AS balance
    FROM "public"."technicians" t
    LEFT JOIN LATERAL (SELECT SUM(s.total) AS total FROM "public"."PaySlip" s
      WHERE s."technicianId"=t.id AND s.status='completed') earned ON true
    LEFT JOIN LATERAL (SELECT SUM(d.amount) AS total FROM "public"."StaffPayment" p
      JOIN "public"."financial_documents" d ON d.id=p."documentId"
      WHERE p."technicianId"=t.id AND NOT EXISTS (
        SELECT 1 FROM "public"."financial_documents" r WHERE r."reversalOfId"=d.id
      )) paid ON true
    WHERE t."organizationId"=${organizationId} ORDER BY t.name,t.id`
}
