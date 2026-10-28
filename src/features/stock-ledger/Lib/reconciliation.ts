import { D } from './amounts'
import type { Tx, LedgerContext } from './transaction'
export async function reconciliation(tx: Tx, ctx: LedgerContext) {
  const org = { organizationId: ctx.organizationId }
  const balances = await tx.stockLotBalance.findMany({ where: org })
  const movements = await tx.inventoryLedgerEntry.groupBy({
    by: ['lotId', 'warehouseId'],
    where: org,
    _sum: { quantityDelta: true },
  })
  const reservations = await tx.stockReservation.groupBy({
    by: ['lotId', 'warehouseId'],
    where: org,
    _sum: { remainingQuantity: true },
  })
  const movementsByKey = new Map(
    movements.map((m) => [m.lotId + ':' + m.warehouseId, m._sum.quantityDelta ?? D(0)])
  )
  const reservationsByKey = new Map(
    reservations.map((r) => [r.lotId + ':' + r.warehouseId, r._sum.remainingQuantity ?? D(0)])
  )
  const discrepancies = []
  for (const balance of balances) {
    const key = balance.lotId + ':' + balance.warehouseId
    const expected = movementsByKey.get(key) ?? D(0),
      reserved = reservationsByKey.get(key) ?? D(0)
    if (!expected.eq(balance.onHandQty) || !reserved.eq(balance.reservedQty))
      discrepancies.push({
        id: balance.id,
        onHand: balance.onHandQty.toString(),
        expected: expected.toString(),
        reserved: balance.reservedQty.toString(),
        expectedReserved: reserved.toString(),
      })
    movementsByKey.delete(key)
    reservationsByKey.delete(key)
  }
  for (const [id, expected] of movementsByKey)
    if (!expected.isZero())
      discrepancies.push({
        id,
        onHand: '0',
        expected: expected.toString(),
        reserved: '0',
        expectedReserved: (reservationsByKey.get(id) ?? D(0)).toString(),
      })
  for (const [id, reserved] of reservationsByKey)
    if (!movementsByKey.has(id) && !reserved.isZero())
      discrepancies.push({
        id,
        onHand: '0',
        expected: '0',
        reserved: '0',
        expectedReserved: reserved.toString(),
      })
  return discrepancies
}
export function csvCell(value: unknown) {
  const text = String(value ?? '')
  return '"' + (/^[=+\-@\t\r]/.test(text) ? "'" + text : text).replaceAll('"', '""') + '"'
}

export async function fullReconciliation(tx: Tx, ctx: LedgerContext) {
  const quantity = await reconciliation(tx, ctx)
  const issues = quantity.map((r) => ({
    id: r.id,
    kind: 'Залишок або резерв',
    expected: `${r.expected} / ${r.expectedReserved}`,
    actual: `${r.onHand} / ${r.reserved}`,
  }))
  const rows = await tx.$queryRaw<{ id: string; kind: string; expected: string; actual: string }[]>`
 WITH cash_expected AS (
  SELECT "accountId",SUM(amount*CASE direction WHEN 'IN' THEN 1 ELSE -1 END) amount FROM "public"."money_transactions" WHERE "organizationId"=${ctx.organizationId} AND status IN ('POSTED','REVERSED') GROUP BY "accountId"
  UNION ALL SELECT "accountId",SUM(amount) FROM "public"."opening_balances" WHERE "organizationId"=${ctx.organizationId} AND "accountId" IS NOT NULL GROUP BY "accountId"
 ), cash AS (
  SELECT a.id,COALESCE((SELECT SUM(e.amount) FROM cash_expected e WHERE e."accountId"=a.id),0) expected,COALESCE((SELECT SUM(c."amountDelta") FROM "public"."cash_ledger_entries" c WHERE c."accountId"=a.id AND c."organizationId"=${ctx.organizationId}),0) actual FROM "public"."cash_accounts" a WHERE a."organizationId"=${ctx.organizationId}
 ), sources AS (
  SELECT d.id,'Документ постачальника'::text kind,d."totalAmount" expected,COALESCE(SUM(e.amount),0) actual FROM "public"."inventory_documents" d LEFT JOIN "public"."settlement_entries" e ON e."inventoryDocumentId"=d.id AND e."organizationId"=d."organizationId" WHERE d."organizationId"=${ctx.organizationId} AND d.status IN ('POSTED','REVERSED') AND d.kind IN ('RECEIPT','SUPPLIER_RETURN','REVERSAL') GROUP BY d.id
  UNION ALL SELECT d.id,'Послуга підрядника',d."totalAmount",COALESCE(SUM(e.amount),0) FROM "public"."supplier_service_documents" d LEFT JOIN "public"."settlement_entries" e ON e."supplierServiceDocumentId"=d.id AND e."organizationId"=d."organizationId" WHERE d."organizationId"=${ctx.organizationId} AND d.status='POSTED' GROUP BY d.id
  UNION ALL SELECT m.id,'Платіж у взаєморозрахунках',m.amount,COALESCE(SUM(e.amount),0) FROM "public"."money_transactions" m LEFT JOIN "public"."settlement_entries" e ON e."moneyTransactionId"=m.id AND e."organizationId"=m."organizationId" WHERE m."organizationId"=${ctx.organizationId} AND m."partyId" IS NOT NULL AND m.status IN ('POSTED','REVERSED') GROUP BY m.id
  UNION ALL SELECT o.id,'Початковий баланс контрагента',o.amount,COALESCE(SUM(e.amount),0) FROM "public"."opening_balances" o LEFT JOIN "public"."settlement_entries" e ON e."openingBalanceId"=o.id AND e."organizationId"=o."organizationId" WHERE o."organizationId"=${ctx.organizationId} AND o."partyId" IS NOT NULL GROUP BY o.id
  UNION ALL SELECT a.id,'Коригування рахунку клієнта',a.amount,COALESCE(SUM(e.amount),0) FROM "public"."customer_adjustments" a LEFT JOIN "public"."settlement_entries" e ON e."customerAdjustmentId"=a.id AND e."organizationId"=a."organizationId" WHERE a."organizationId"=${ctx.organizationId} GROUP BY a.id
  UNION ALL SELECT j.id,'Рахунок клієнта',(j."ledgerFinancialSnapshot"->>'total')::numeric,COALESCE(SUM(e.amount),0) FROM "public"."service_records" j LEFT JOIN "public"."settlement_entries" e ON e."serviceRecordId"=j.id AND e."organizationId"=j."organizationId" WHERE j."organizationId"=${ctx.organizationId} AND j."financeAccountingMode"='LEDGER' AND j."ledgerFinancialSnapshot"->>'total' IS NOT NULL GROUP BY j.id
 ), reserves AS (
  SELECT r.id,r."remainingQuantity" actual,COALESCE(SUM(e.quantity*CASE WHEN e.kind='RESERVE' THEN 1 ELSE -1 END),0) expected FROM "public"."stock_reservations" r LEFT JOIN "public"."reservation_events" e ON e."reservationId"=r.id AND e."organizationId"=r."organizationId" WHERE r."organizationId"=${ctx.organizationId} GROUP BY r.id
 ), costs AS (
  SELECT "lotId"||' / '||"warehouseId" id,SUM("quantityDelta") qty,SUM("costAmountDelta") cost FROM "public"."inventory_ledger_entries" WHERE "organizationId"=${ctx.organizationId} GROUP BY "lotId","warehouseId"
 ), allocations AS (
  SELECT e.id,e.amount,COALESCE(SUM(a.amount),0) allocated FROM "public"."settlement_entries" e LEFT JOIN "public"."settlement_allocations" a ON a."organizationId"=e."organizationId" AND a."reversedAt" IS NULL AND (a."debitEntryId"=e.id OR a."creditEntryId"=e.id) WHERE e."organizationId"=${ctx.organizationId} GROUP BY e.id
 )
 SELECT id,'Каса: документи проти журналу' kind,expected::text,actual::text FROM cash WHERE expected<>actual
 UNION ALL SELECT id,kind,expected::text,actual::text FROM sources WHERE expected<>actual
 UNION ALL SELECT id,'Резерв: події проти проєкції',expected::text,actual::text FROM reserves WHERE expected<>actual
 UNION ALL SELECT id,'Вартість порожньої або від’ємної партії','0',cost::text FROM costs WHERE cost<0 OR qty<0 OR (qty=0 AND cost<>0)
 UNION ALL SELECT id,'Надмірне рознесення',amount::text,allocated::text FROM allocations WHERE allocated>amount
 `
  return [...issues, ...rows]
}
