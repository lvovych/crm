ALTER TABLE service_parts ADD COLUMN "stockOwnership" text NOT NULL DEFAULT 'OWN', ADD COLUMN "customerPartInstalled" boolean NOT NULL DEFAULT false;
ALTER TABLE service_parts ADD CONSTRAINT part_ownership CHECK("stockOwnership" IN ('OWN','CUSTOMER'));
ALTER TABLE stock_demands ALTER COLUMN "servicePartId" DROP NOT NULL;
ALTER TABLE stock_demands ADD CONSTRAINT active_demand_part CHECK(state<>'ACTIVE' OR "servicePartId" IS NOT NULL);

CREATE FUNCTION ledger_has_unfulfilled_parts(record_id text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(
  SELECT 1 FROM service_parts p LEFT JOIN stock_demands d ON d."servicePartId"=p.id AND d.state='ACTIVE'
  WHERE p."serviceRecordId"=record_id AND p.quantity>0 AND (
   (p."stockOwnership"='CUSTOMER' AND NOT p."customerPartInstalled") OR
   (p."stockOwnership"='OWN' AND (p."inventoryPartId" IS NULL OR d.id IS NULL OR p.quantity>COALESCE((SELECT sum(CASE WHEN doc.kind='ISSUE' THEN a.quantity ELSE -a.quantity END) FROM document_lot_allocations a JOIN inventory_document_lines l ON l.id=a."documentLineId" JOIN inventory_documents doc ON doc.id=l."documentId" WHERE a."demandId"=d.id),0)))
  )
 );
$$;
CREATE OR REPLACE FUNCTION ledger_completion_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."inventoryAccountingMode"='LEDGER' AND NEW.status='completed' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."organizationId",613));
  IF ledger_has_unfulfilled_parts(NEW.id) THEN RAISE EXCEPTION 'Issue own parts or confirm installation of customer parts before completing the work order'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION ledger_final_completion_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE record_id text; record service_records;
BEGIN
 IF TG_TABLE_NAME='service_records' THEN record_id=NEW.id; ELSE record_id=NEW."serviceRecordId"; END IF;
 SELECT * INTO record FROM service_records WHERE id=record_id;
 IF record."inventoryAccountingMode"='LEDGER' AND record.status='completed' AND ledger_has_unfulfilled_parts(record_id) THEN RAISE EXCEPTION 'Issue own parts or confirm installation of customer parts before completing the work order'; END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION customer_part_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW."stockOwnership"<>OLD."stockOwnership" AND EXISTS(SELECT 1 FROM stock_demands WHERE "servicePartId"=OLD.id) THEN RAISE EXCEPTION 'Cancel the stock demand before changing ownership'; END IF;
 IF NEW."stockOwnership"='CUSTOMER' AND EXISTS(SELECT 1 FROM service_records WHERE id=NEW."serviceRecordId" AND "inventoryAccountingMode"='LEDGER') THEN NEW."unitCost"=0; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER customer_part_guard BEFORE INSERT OR UPDATE ON service_parts FOR EACH ROW EXECUTE FUNCTION customer_part_guard();
