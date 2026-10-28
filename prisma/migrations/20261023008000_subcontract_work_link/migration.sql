ALTER TABLE supplier_service_lines ADD COLUMN "serviceLaborId" TEXT;
ALTER TABLE supplier_service_lines ADD CONSTRAINT supplier_service_lines_labor_fk FOREIGN KEY ("serviceLaborId") REFERENCES service_labor(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX supplier_service_lines_labor_idx ON supplier_service_lines("organizationId","serviceLaborId");
CREATE FUNCTION ledger_subcontract_work_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."serviceLaborId" IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM service_labor l JOIN service_records r ON r.id=l."serviceRecordId"
  WHERE l.id=NEW."serviceLaborId" AND r.id=NEW."serviceRecordId" AND r."organizationId"=NEW."organizationId" AND l."executionType"='SUBCONTRACT'
 ) THEN RAISE EXCEPTION 'Subcontract work must belong to this work order and organization'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER ledger_subcontract_work_guard BEFORE INSERT OR UPDATE ON supplier_service_lines FOR EACH ROW EXECUTE FUNCTION ledger_subcontract_work_guard();
CREATE FUNCTION ledger_protect_subcontract_work() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW."serviceRecordId" IS DISTINCT FROM OLD."serviceRecordId" OR NEW."executionType" IS DISTINCT FROM OLD."executionType") AND EXISTS (SELECT 1 FROM supplier_service_lines WHERE "serviceLaborId"=OLD.id) THEN
  RAISE EXCEPTION 'Posted subcontract work cannot change order or execution type';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER ledger_protect_subcontract_work BEFORE UPDATE ON service_labor FOR EACH ROW EXECUTE FUNCTION ledger_protect_subcontract_work();
