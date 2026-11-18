import { Prisma } from '@/generated/prisma/client'
import type { TxClient } from '@/lib/db'
import type { LedgerDocument } from './projection'

/** One row per document, never its entire history. PostgreSQL keeps exact sums. */
export async function ledgerSummaries(
  tx: TxClient,
  org: string,
  asOf: string,
  customerId?: string
): Promise<LedgerDocument[]> {
  const rows = await tx.$queryRaw<
    (Omit<LedgerDocument, 'events' | 'eventCount'> & {
      eventCount: bigint
      firstDate: Date
      charge: string
      paid: string
      eventId: bigint
      status: string
      amount: string | null
      due: Date | null
      manualPaid: boolean | null
    })[]
  >(Prisma.sql`
    SELECT d.id, d."customerId", d."customerName", d."vehicleId", d.label,
      sums."eventCount", sums."firstDate", sums.charge, sums.paid, state.id AS "eventId",
      state.status, state.amount::text, state.due, state."manualPaid"
    FROM "public"."customer_ledger_documents" d
    JOIN LATERAL (
      SELECT COUNT(*) AS "eventCount", MIN(e."effectiveDate") AS "firstDate", SUM(e."chargeDelta")::text AS charge,
        SUM(e."paidDelta")::text AS paid
      FROM "public"."customer_ledger_events" e
      WHERE e."organizationId" = ${org} AND e."documentId" = d.id AND e."effectiveDate" <= ${new Date(asOf)}::date
    ) sums ON true
    JOIN LATERAL (
      SELECT e.id, e.status, e.amount, e.due, e."manualPaid"
      FROM "public"."customer_ledger_events" e
      WHERE e."organizationId" = ${org} AND e."documentId" = d.id
        AND e."effectiveDate" <= ${new Date(asOf)}::date AND e.status IS NOT NULL
      ORDER BY e."effectiveDate" DESC, e.id DESC LIMIT 1
    ) state ON true
    WHERE d."organizationId" = ${org} ${customerId ? Prisma.sql`AND d."customerId" = ${customerId}` : Prisma.empty}
    ORDER BY d.id`)
  return rows.map((r) => ({
    id: r.id,
    customerId: r.customerId,
    customerName: r.customerName,
    vehicleId: r.vehicleId,
    label: r.label,
    eventCount: Number(r.eventCount),
    events: [
      {
        id: String(r.eventId),
        kind: 'summary',
        date: r.firstDate.toISOString().slice(0, 10),
        recordedAt: '',
        chargeDelta: r.charge,
        paidDelta: r.paid,
        amount: r.amount,
        status: r.status,
        due: r.due?.toISOString().slice(0, 10) ?? null,
        manualPaid: r.manualPaid,
        paymentId: null,
        sourceDate: null,
        actor: null,
        note: null,
      },
    ],
  }))
}
