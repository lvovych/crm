ALTER TABLE service_records ADD COLUMN "billedPartyId" text;
ALTER TABLE service_records ADD CONSTRAINT ledger_billed_party_fk FOREIGN KEY("organizationId","billedPartyId") REFERENCES settlement_parties("organizationId",id) ON DELETE RESTRICT ON UPDATE RESTRICT;
UPDATE service_records SET "billedPartyId"="ledgerFinancialSnapshot"->>'partyId' WHERE "financeAccountingMode"='LEDGER' AND "ledgerFinancialSnapshot" IS NOT NULL;
CREATE FUNCTION ledger_invoice_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."financeAccountingMode"='LEDGER' AND OLD."ledgerFinancialSnapshot" IS NOT NULL THEN
  IF ROW(NEW."financeAccountingMode",NEW."ledgerFinancialSnapshot",NEW."billedPartyId",NEW.cost,NEW.subtotal,NEW."taxRate",NEW."taxAmount",NEW."taxInclusive",NEW."taxComponents",NEW."totalAmount",NEW."discountType",NEW."discountValue",NEW."discountAmount",NEW."manuallyPaid") IS DISTINCT FROM ROW(OLD."financeAccountingMode",OLD."ledgerFinancialSnapshot",OLD."billedPartyId",OLD.cost,OLD.subtotal,OLD."taxRate",OLD."taxAmount",OLD."taxInclusive",OLD."taxComponents",OLD."totalAmount",OLD."discountType",OLD."discountValue",OLD."discountAmount",OLD."manuallyPaid") THEN
    RAISE EXCEPTION 'Виставлений рахунок незмінний. Створіть фінансове коригування.';
  END IF;
 END IF;
 IF NEW."financeAccountingMode"='LEDGER' AND NEW."ledgerFinancialSnapshot" IS NOT NULL THEN
  IF NEW."billedPartyId" IS NULL OR NEW."billedPartyId" IS DISTINCT FROM NEW."ledgerFinancialSnapshot"->>'partyId' OR (NEW."ledgerFinancialSnapshot"->>'total')::numeric <> NEW."totalAmount"::numeric THEN
    RAISE EXCEPTION 'Фінансовий знімок не відповідає наряду';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ledger_invoice_freeze BEFORE UPDATE ON service_records FOR EACH ROW EXECUTE FUNCTION ledger_invoice_freeze();
CREATE FUNCTION ledger_invoice_line_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent text; frozen boolean;
BEGIN
 parent := CASE WHEN TG_OP='DELETE' THEN OLD."serviceRecordId" ELSE NEW."serviceRecordId" END;
 SELECT "financeAccountingMode"='LEDGER' AND "ledgerFinancialSnapshot" IS NOT NULL INTO frozen FROM service_records WHERE id=parent FOR UPDATE;
 IF TG_OP='UPDATE' AND OLD."serviceRecordId" IS DISTINCT FROM NEW."serviceRecordId" THEN
  IF EXISTS(SELECT 1 FROM service_records WHERE id=OLD."serviceRecordId" AND "financeAccountingMode"='LEDGER' AND "ledgerFinancialSnapshot" IS NOT NULL) THEN RAISE EXCEPTION 'Позиція виставленого рахунку незмінна'; END IF;
 END IF;
 IF frozen THEN
  IF TG_OP IN ('INSERT','DELETE') THEN RAISE EXCEPTION 'Позиції виставленого рахунку незмінні'; END IF;
  IF TG_TABLE_NAME='service_parts' THEN
   IF (to_jsonb(NEW)-ARRAY['sortOrder','name','partNumber','brand']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['sortOrder','name','partNumber','brand']) THEN RAISE EXCEPTION 'Суми виставленої позиції незмінні'; END IF;
  ELSE
   IF (to_jsonb(NEW)-ARRAY['sortOrder','description','technicianId','executorName','executorFrozen','executorLegacy','executionType']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['sortOrder','description','technicianId','executorName','executorFrozen','executorLegacy','executionType']) THEN RAISE EXCEPTION 'Суми виставленої роботи незмінні'; END IF;
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER ledger_part_invoice_freeze BEFORE INSERT OR UPDATE OR DELETE ON service_parts FOR EACH ROW EXECUTE FUNCTION ledger_invoice_line_freeze();
CREATE TRIGGER ledger_labor_invoice_freeze BEFORE INSERT OR UPDATE OR DELETE ON service_labor FOR EACH ROW EXECUTE FUNCTION ledger_invoice_line_freeze();
