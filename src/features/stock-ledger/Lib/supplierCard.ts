import { z } from 'zod'
import type { Tx, LedgerContext } from './transaction'
export async function supplierCard(tx: Tx, ctx: LedgerContext, raw: unknown) {
  const input = z
    .object({
      supplierId: z.string().min(1),
      tab: z.enum(['receipts', 'services', 'orders', 'payments']).default('receipts'),
      page: z.number().int().min(1).max(100000).default(1),
    })
    .parse(raw)
  const org = { organizationId: ctx.organizationId }
  const supplier = await tx.supplier.findFirst({
    where: { ...org, id: input.supplierId },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      taxId: true,
      address: true,
      bankDetails: true,
      paymentTermsDays: true,
      kind: true,
    },
  })
  if (!supplier) throw new Error('Постачальник не знайдений')
  const party = await tx.settlementParty.findFirst({
    where: { ...org, supplierId: supplier.id },
    select: { id: true },
  })
  const where = { ...org, supplierId: supplier.id },
    pagination = { skip: (input.page - 1) * 25, take: 25 },
    orderBy = [{ createdAt: 'desc' as const }, { id: 'desc' as const }]
  type Row = {
    id: string
    number: string
    status: string
    date: string
    amount: string | null
    note: string | null
    kind: 'receipt' | 'subcontract' | 'payment' | null
  }
  let rows: Row[], total: number
  if (input.tab === 'receipts') {
    const [docs, count] = await Promise.all([
      tx.inventoryDocument.findMany({ where, ...pagination, orderBy }),
      tx.inventoryDocument.count({ where }),
    ])
    total = count
    rows = docs.map((d) => ({
      id: d.id,
      number: d.number,
      status: d.status,
      date: d.effectiveAt.toISOString().slice(0, 10),
      amount: d.totalAmount.toFixed(2),
      note: d.externalNumber,
      kind: 'receipt',
    }))
  } else if (input.tab === 'services') {
    const [docs, count] = await Promise.all([
      tx.supplierServiceDocument.findMany({ where, ...pagination, orderBy }),
      tx.supplierServiceDocument.count({ where }),
    ])
    total = count
    rows = docs.map((d) => ({
      id: d.id,
      number: d.number,
      status: d.status,
      date: d.effectiveAt.toISOString().slice(0, 10),
      amount: d.totalAmount.toFixed(2),
      note: d.externalNumber,
      kind: 'subcontract',
    }))
  } else if (input.tab === 'orders') {
    const [docs, count] = await Promise.all([
      tx.purchaseOrder.findMany({ where, ...pagination, orderBy }),
      tx.purchaseOrder.count({ where }),
    ])
    total = count
    rows = docs.map((d) => ({
      id: d.id,
      number: d.number,
      status: d.status,
      date: d.expectedAt?.toISOString().slice(0, 10) ?? '—',
      amount: null,
      note: d.note,
      kind: null,
    }))
  } else {
    const filter = { ...org, partyId: party?.id ?? '__no_party__' }
    const [docs, count] = await Promise.all([
      tx.moneyTransaction.findMany({
        where: filter,
        ...pagination,
        orderBy,
        include: { account: { select: { name: true } } },
      }),
      tx.moneyTransaction.count({ where: filter }),
    ])
    total = count
    rows = docs.map((d) => ({
      id: d.id,
      number: `${d.direction === 'OUT' ? 'Витрата' : 'Надходження'} · ${d.account.name}`,
      status: d.status,
      date: d.effectiveAt.toISOString().slice(0, 10),
      amount: d.amount.toFixed(2),
      note: d.note,
      kind: 'payment',
    }))
  }
  const balances = party
    ? await tx.$queryRaw<{ debt: string; advance: string; overdue: string }[]>`
    WITH applied AS (SELECT "debitEntryId" AS id,SUM(amount) AS amount FROM "public"."settlement_allocations" WHERE "organizationId"=${ctx.organizationId} AND "reversedAt" IS NULL GROUP BY "debitEntryId" UNION ALL SELECT "creditEntryId",SUM(amount) FROM "public"."settlement_allocations" WHERE "organizationId"=${ctx.organizationId} AND "reversedAt" IS NULL GROUP BY "creditEntryId")
    SELECT COALESCE(SUM(CASE WHEN e.polarity='DEBIT' THEN e.amount-COALESCE(a.amount,0) ELSE 0 END),0)::text AS debt,
    COALESCE(SUM(CASE WHEN e.polarity='CREDIT' THEN e.amount-COALESCE(a.amount,0) ELSE 0 END),0)::text AS advance,
    COALESCE(SUM(CASE WHEN e.polarity='DEBIT' AND e."dueDate"<(CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Kyiv')::date THEN e.amount-COALESCE(a.amount,0) ELSE 0 END),0)::text AS overdue
    FROM "public"."settlement_entries" e LEFT JOIN applied a ON a.id=e.id WHERE e."organizationId"=${ctx.organizationId} AND e."partyId"=${party.id} AND e.side='AP'`
    : []
  return {
    supplier,
    partyId: party?.id,
    rows,
    total,
    balance: balances[0] ?? { debt: '0.00', advance: '0.00', overdue: '0.00' },
  }
}
