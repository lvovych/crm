CREATE OR REPLACE VIEW ledger_customer_balances AS
WITH uses AS (SELECT "debitEntryId", SUM(amount) used FROM settlement_allocations WHERE "reversedAt" IS NULL GROUP BY "debitEntryId"),
documents AS (
 SELECT e."organizationId", COALESCE(e."serviceRecordId",a."serviceRecordId") "serviceRecordId", e.polarity, e.amount, COALESCE(u.used,0) used
 FROM settlement_entries e LEFT JOIN customer_adjustments a ON a.id=e."customerAdjustmentId" AND a."organizationId"=e."organizationId" LEFT JOIN uses u ON u."debitEntryId"=e.id
 WHERE e."serviceRecordId" IS NOT NULL OR a.id IS NOT NULL
)
SELECT "organizationId","serviceRecordId",
 SUM(CASE polarity WHEN 'DEBIT' THEN amount ELSE -amount END)::numeric(20,2) total,
 SUM(CASE polarity WHEN 'DEBIT' THEN amount-used ELSE 0 END)::numeric(20,2) debt
FROM documents GROUP BY "organizationId","serviceRecordId"
UNION ALL
SELECT j."organizationId",j.id AS "serviceRecordId",0::numeric(20,2) AS total,0::numeric(20,2) AS debt
FROM service_records j WHERE j."financeAccountingMode"='LEDGER' AND j."billedPartyId" IS NOT NULL AND j."ledgerFinancialSnapshot"->>'total'='0.00' AND NOT EXISTS(SELECT 1 FROM documents d WHERE d."serviceRecordId"=j.id);
