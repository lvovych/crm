-- The editor saves the work-order header before its lines. Validate the final
-- transaction state, not just the header's previous set of parts.
CREATE FUNCTION ledger_final_completion_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE record_id text; record service_records;
BEGIN
 IF TG_TABLE_NAME='service_records' THEN record_id=NEW.id; ELSE record_id=NEW."serviceRecordId"; END IF;
 SELECT * INTO record FROM service_records WHERE id=record_id;
 IF record."inventoryAccountingMode"='LEDGER' AND record.status='completed' AND EXISTS (
  SELECT 1 FROM service_parts p LEFT JOIN stock_demands d ON d."servicePartId"=p.id
  WHERE p."serviceRecordId"=record_id AND p."inventoryPartId" IS NOT NULL AND
   (d.id IS NULL OR (d.ownership='OWN' AND p.quantity>COALESCE((SELECT SUM(CASE WHEN doc.kind='ISSUE' THEN a.quantity ELSE -a.quantity END) FROM document_lot_allocations a JOIN inventory_document_lines l ON l.id=a."documentLineId" JOIN inventory_documents doc ON doc.id=l."documentId" WHERE a."demandId"=d.id),0)))
 ) THEN RAISE EXCEPTION 'Issue all required parts before completing the work order'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_final_completion_header AFTER INSERT OR UPDATE ON service_records DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_final_completion_guard();
CREATE CONSTRAINT TRIGGER ledger_final_completion_part AFTER INSERT OR UPDATE ON service_parts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_final_completion_guard();

-- Allocations are append-only apart from one explicit reversal. Amounts and
-- identities can never be rewritten under a historical date.
CREATE FUNCTION settlement_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Allocations cannot be deleted'; END IF;
 IF OLD."reversedAt" IS NOT NULL OR NEW."reversedAt" IS NULL OR NEW."reversalReason" IS NULL OR NEW."reversalReason"='' OR
  (to_jsonb(NEW)-'reversedAt'-'reversalReason') IS DISTINCT FROM (to_jsonb(OLD)-'reversedAt'-'reversalReason')
 THEN RAISE EXCEPTION 'Only explicit allocation reversal is allowed'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER settlement_allocation_guard BEFORE UPDATE OR DELETE ON settlement_allocations FOR EACH ROW EXECUTE FUNCTION settlement_allocation_guard();
