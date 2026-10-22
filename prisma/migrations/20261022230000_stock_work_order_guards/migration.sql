CREATE FUNCTION ledger_demand_sync() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d stock_demands; issued numeric; reserved numeric;
BEGIN
 SELECT * INTO d FROM stock_demands WHERE "servicePartId"=OLD.id AND "organizationId"=OLD."organizationId";
 IF NOT FOUND THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(OLD."organizationId",613));
 IF NEW."inventoryPartId" IS DISTINCT FROM OLD."inventoryPartId" OR NEW."serviceRecordId"<>OLD."serviceRecordId" THEN RAISE EXCEPTION 'Cannot change a product with a stock demand'; END IF;
 SELECT COALESCE(SUM(CASE WHEN doc.kind='ISSUE' THEN a.quantity ELSE -a.quantity END),0) INTO issued FROM document_lot_allocations a JOIN inventory_document_lines l ON l.id=a."documentLineId" JOIN inventory_documents doc ON doc.id=l."documentId" WHERE a."demandId"=d.id;
 SELECT COALESCE(SUM("remainingQuantity"),0) INTO reserved FROM stock_reservations WHERE "demandId"=d.id;
 IF NEW.quantity<issued+reserved THEN RAISE EXCEPTION 'Return issued parts or release reservations before reducing quantity'; END IF;
 UPDATE stock_demands SET "requiredQty"=NEW.quantity,version=version+1 WHERE id=d.id;
 RETURN NEW;
END $$;
CREATE TRIGGER ledger_demand_sync BEFORE UPDATE ON service_parts FOR EACH ROW EXECUTE FUNCTION ledger_demand_sync();
CREATE FUNCTION ledger_completion_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."inventoryAccountingMode"='LEDGER' AND NEW.status='completed' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."organizationId",613));
  IF EXISTS (
   SELECT 1 FROM service_parts p LEFT JOIN stock_demands d ON d."servicePartId"=p.id
   WHERE p."serviceRecordId"=NEW.id AND p."inventoryPartId" IS NOT NULL AND
    (d.id IS NULL OR (d.ownership='OWN' AND p.quantity > COALESCE((SELECT SUM(CASE WHEN doc.kind='ISSUE' THEN a.quantity ELSE -a.quantity END) FROM document_lot_allocations a JOIN inventory_document_lines l ON l.id=a."documentLineId" JOIN inventory_documents doc ON doc.id=l."documentId" WHERE a."demandId"=d.id),0)))
  ) THEN RAISE EXCEPTION 'Issue all required parts before completing the work order'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ledger_completion_guard BEFORE UPDATE ON service_records FOR EACH ROW EXECUTE FUNCTION ledger_completion_guard();
