CREATE OR REPLACE FUNCTION ledger_invoice_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."financeAccountingMode"='LEDGER' AND OLD."ledgerFinancialSnapshot" IS NOT NULL AND OLD."ledgerFinancialSnapshot" <> 'null'::jsonb THEN
  IF ROW(NEW."financeAccountingMode",NEW."ledgerFinancialSnapshot",NEW."billedPartyId",NEW.cost,NEW.subtotal,NEW."taxRate",NEW."taxAmount",NEW."taxInclusive",NEW."taxComponents",NEW."totalAmount",NEW."discountType",NEW."discountValue",NEW."discountAmount",NEW."manuallyPaid") IS DISTINCT FROM ROW(OLD."financeAccountingMode",OLD."ledgerFinancialSnapshot",OLD."billedPartyId",OLD.cost,OLD.subtotal,OLD."taxRate",OLD."taxAmount",OLD."taxInclusive",OLD."taxComponents",OLD."totalAmount",OLD."discountType",OLD."discountValue",OLD."discountAmount",OLD."manuallyPaid") THEN
    RAISE EXCEPTION 'Виставлений рахунок незмінний. Створіть фінансове коригування.';
  END IF;
 END IF;
 IF NEW."financeAccountingMode"='LEDGER' AND NEW."ledgerFinancialSnapshot" IS NOT NULL AND NEW."ledgerFinancialSnapshot" <> 'null'::jsonb THEN
  IF NEW."billedPartyId" IS NULL OR NEW."billedPartyId" IS DISTINCT FROM NEW."ledgerFinancialSnapshot"->>'partyId' OR (NEW."ledgerFinancialSnapshot"->>'total')::numeric <> NEW."totalAmount"::numeric THEN
    RAISE EXCEPTION 'Фінансовий знімок не відповідає наряду';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION ledger_invoice_line_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent text; frozen boolean;
BEGIN
 parent := CASE WHEN TG_OP='DELETE' THEN OLD."serviceRecordId" ELSE NEW."serviceRecordId" END;
 SELECT "financeAccountingMode"='LEDGER' AND "ledgerFinancialSnapshot" IS NOT NULL AND "ledgerFinancialSnapshot" <> 'null'::jsonb INTO frozen FROM service_records WHERE id=parent FOR UPDATE;
 IF TG_OP='UPDATE' AND OLD."serviceRecordId" IS DISTINCT FROM NEW."serviceRecordId" THEN
  IF EXISTS(SELECT 1 FROM service_records WHERE id=OLD."serviceRecordId" AND "financeAccountingMode"='LEDGER' AND "ledgerFinancialSnapshot" IS NOT NULL AND "ledgerFinancialSnapshot" <> 'null'::jsonb) THEN RAISE EXCEPTION 'Позиція виставленого рахунку незмінна'; END IF;
 END IF;
 IF frozen THEN
  IF TG_OP IN ('INSERT','DELETE') THEN RAISE EXCEPTION 'Позиції виставленого рахунку незмінні'; END IF;
  IF TG_TABLE_NAME='service_parts' THEN
   IF (to_jsonb(NEW)-ARRAY['sortOrder','name','partNumber','brand','customerPartInstalled']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['sortOrder','name','partNumber','brand','customerPartInstalled']) THEN RAISE EXCEPTION 'Суми виставленої позиції незмінні'; END IF;
  ELSE
   IF (to_jsonb(NEW)-ARRAY['sortOrder','description','technicianId','executorName','executorFrozen','executorLegacy','executionType']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['sortOrder','description','technicianId','executorName','executorFrozen','executorLegacy','executionType']) THEN RAISE EXCEPTION 'Суми виставленої роботи незмінні'; END IF;
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;

CREATE VIEW ledger_customer_balances AS
WITH uses AS (SELECT "debitEntryId", SUM(amount) used FROM settlement_allocations WHERE "reversedAt" IS NULL GROUP BY "debitEntryId"),
documents AS (
 SELECT e."organizationId", COALESCE(e."serviceRecordId",a."serviceRecordId") "serviceRecordId", e.polarity, e.amount, COALESCE(u.used,0) used
 FROM settlement_entries e LEFT JOIN customer_adjustments a ON a.id=e."customerAdjustmentId" AND a."organizationId"=e."organizationId" LEFT JOIN uses u ON u."debitEntryId"=e.id
 WHERE e."serviceRecordId" IS NOT NULL OR a.id IS NOT NULL
)
SELECT "organizationId","serviceRecordId",
 SUM(CASE polarity WHEN 'DEBIT' THEN amount ELSE -amount END)::numeric(20,2) total,
 SUM(CASE polarity WHEN 'DEBIT' THEN amount-used ELSE 0 END)::numeric(20,2) debt
FROM documents GROUP BY "organizationId","serviceRecordId";
