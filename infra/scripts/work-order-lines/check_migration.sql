\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA work_order_lines_test;
SET LOCAL search_path = work_order_lines_test;
CREATE TABLE technicians (id text PRIMARY KEY,name text,"organizationId" text,"isActive" boolean DEFAULT true);
CREATE TABLE service_records (id text PRIMARY KEY,status text,"technicianId" text,"organizationId" text);
CREATE TABLE service_parts (id text PRIMARY KEY,"serviceRecordId" text,quantity float8,"unitPrice" float8,total float8);
CREATE TABLE service_labor (id text PRIMARY KEY,"serviceRecordId" text,"pricingType" text DEFAULT 'hourly',total float8);
INSERT INTO technicians VALUES ('a','Mechanic A','org',true),('b','Mechanic B','org',true),('foreign','Other','other',true);
INSERT INTO service_records VALUES ('old','completed','a','org'),('open','pending','a','org');
INSERT INTO service_parts VALUES ('p','old',2,100,197);
INSERT INTO service_labor VALUES ('l','old','hourly',100);
\ir ../../../prisma/migrations/20261022120000_work_order_lines/migration.sql
DO $$ BEGIN
 IF (SELECT total FROM service_parts WHERE id='p')<>197 THEN RAISE EXCEPTION 'Historical amount changed'; END IF;
 IF NOT (SELECT "executorFrozen" AND "executorLegacy" AND "executorName"='Mechanic A' FROM service_labor WHERE id='l') THEN RAISE EXCEPTION 'Legacy provenance lost'; END IF;
 INSERT INTO service_labor(id,"serviceRecordId",total) VALUES ('inherit','open',100);
 INSERT INTO service_labor(id,"serviceRecordId","technicianId",total) VALUES ('explicit','open','b',100);
 UPDATE service_records SET status='completed' WHERE id='open';
 IF NOT (SELECT "executorFrozen" AND "executorName"='Mechanic A' AND NOT "executorLegacy" FROM service_labor WHERE id='inherit') THEN RAISE EXCEPTION 'Inherited executor not frozen'; END IF;
 IF NOT (SELECT "executorFrozen" AND "executorName"='Mechanic B' FROM service_labor WHERE id='explicit') THEN RAISE EXCEPTION 'Explicit executor lost'; END IF;
 UPDATE service_records SET "technicianId"='b' WHERE id='open';
 IF (SELECT "executorName" FROM service_labor WHERE id='inherit')<>'Mechanic A' THEN RAISE EXCEPTION 'History changed'; END IF;
 BEGIN
  INSERT INTO service_labor(id,"serviceRecordId","technicianId") VALUES ('bad','open','foreign');
  RAISE EXCEPTION 'Expected tenant rejection';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'Executor must belong to the work order organization' THEN RAISE; END IF;
 END;
 INSERT INTO service_labor(id,"serviceRecordId",total) VALUES ('late','open',10);
 IF NOT (SELECT "executorFrozen" AND "executorName"='Mechanic B' FROM service_labor WHERE id='late') THEN RAISE EXCEPTION 'New completed line not frozen'; END IF;
 BEGIN
  UPDATE service_parts SET "discountType"='percentage',"discountValue"=101 WHERE id='p';
  RAISE EXCEPTION 'Expected discount rejection';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
SELECT 'Migration, historical amounts, executor freezing and tenant isolation passed' AS result;
ROLLBACK;
