ALTER TABLE service_parts ADD COLUMN "discountType" TEXT NOT NULL DEFAULT 'none', ADD COLUMN "discountValue" DOUBLE PRECISION NOT NULL DEFAULT 0, ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE service_parts ADD CONSTRAINT service_parts_discount_check CHECK ("discountType" IN ('none','percentage','fixed') AND "discountValue" >= 0 AND "discountValue" < 'Infinity'::float8 AND ("discountType" <> 'percentage' OR "discountValue" <= 100));
ALTER TABLE service_labor ADD COLUMN "technicianId" TEXT REFERENCES technicians(id) ON DELETE RESTRICT, ADD COLUMN "executorName" TEXT, ADD COLUMN "executorFrozen" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "executorLegacy" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX service_labor_technician_idx ON service_labor("technicianId");
-- Preserve order currently returned by PostgreSQL for historical rows.
WITH numbered AS (SELECT id,row_number() OVER (PARTITION BY "serviceRecordId" ORDER BY ctid)-1 n FROM service_parts) UPDATE service_parts p SET "sortOrder"=n.n FROM numbered n WHERE n.id=p.id;
WITH numbered AS (SELECT id,row_number() OVER (PARTITION BY "serviceRecordId" ORDER BY ctid)-1 n FROM service_labor) UPDATE service_labor l SET "sortOrder"=n.n FROM numbered n WHERE n.id=l.id;
-- Legacy records only know the order's mechanic, not an individual executor.
UPDATE service_labor l SET "executorFrozen"=true,"executorLegacy"=true,"executorName"=(SELECT name FROM technicians WHERE id=r."technicianId") FROM service_records r WHERE r.id=l."serviceRecordId" AND r.status='completed';
CREATE FUNCTION freeze_labor_executors() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='completed' AND OLD.status IS DISTINCT FROM NEW.status THEN
  UPDATE service_labor l SET "executorName"=(SELECT name FROM technicians WHERE id=COALESCE(l."technicianId",NEW."technicianId")),"executorFrozen"=true,"executorLegacy"=false WHERE l."serviceRecordId"=NEW.id AND NOT l."executorFrozen" AND l."pricingType"<>'shopFee';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER service_complete_executors AFTER UPDATE OF status ON service_records FOR EACH ROW EXECUTE FUNCTION freeze_labor_executors();
CREATE FUNCTION check_labor_executor() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE job service_records%ROWTYPE; tech technicians%ROWTYPE;
BEGIN
 SELECT * INTO job FROM service_records WHERE id=NEW."serviceRecordId";
 IF NEW."technicianId" IS NOT NULL THEN
  SELECT * INTO tech FROM technicians WHERE id=NEW."technicianId";
  IF tech.id IS NULL OR tech."organizationId" IS DISTINCT FROM job."organizationId" THEN RAISE EXCEPTION 'Executor must belong to the work order organization'; END IF;
 END IF;
 IF job.status='completed' AND NOT NEW."executorFrozen" AND NEW."pricingType"<>'shopFee' THEN
  NEW."executorName":=(SELECT name FROM technicians WHERE id=COALESCE(NEW."technicianId",job."technicianId"));
  NEW."executorFrozen":=true;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER service_labor_executor BEFORE INSERT OR UPDATE ON service_labor FOR EACH ROW EXECUTE FUNCTION check_labor_executor();
