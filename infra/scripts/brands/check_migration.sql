\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA brand_migration_test;
SET LOCAL search_path = brand_migration_test;
CREATE TABLE inventory_parts (id text PRIMARY KEY);
CREATE TABLE service_parts (id text PRIMARY KEY);
CREATE TABLE quote_parts (id text PRIMARY KEY);
CREATE TABLE labor_preset_parts (id text PRIMARY KEY);
-- The migration is inserted here by the test runner.
\ir ../../../prisma/migrations/20261022100000_part_brands/migration.sql

DO $$ BEGIN
 IF (SELECT count(*) FROM brands) <> 348 THEN RAISE EXCEPTION 'Seed count failed'; END IF;
 BEGIN
  INSERT INTO brands(id,name) VALUES ('duplicate', ' bosch ');
  RAISE EXCEPTION 'Expected unique violation';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN
  UPDATE brands SET name='unknown' WHERE id='brand_unknown';
  RAISE EXCEPTION 'Expected protection';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'The unknown brand is a protected system record' THEN RAISE; END IF;
 END;
 BEGIN
  DELETE FROM brands WHERE id='brand_unknown';
  RAISE EXCEPTION 'Expected protection';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'The unknown brand is a protected system record' THEN RAISE; END IF;
 END;
 BEGIN
  UPDATE brands SET "isActive"=false WHERE id='brand_unknown';
  RAISE EXCEPTION 'Expected protection';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'The unknown brand is a protected system record' THEN RAISE; END IF;
 END;
 INSERT INTO inventory_parts(id) VALUES ('default-brand-test');
 IF (SELECT "brandId" FROM inventory_parts LIMIT 1) <> 'brand_unknown' THEN RAISE EXCEPTION 'Default brand failed'; END IF;
 BEGIN
  UPDATE inventory_parts SET "brandId"='missing';
  RAISE EXCEPTION 'Expected FK violation';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 INSERT INTO brands(id,name) VALUES ('used', 'Test linked brand');
 UPDATE inventory_parts SET "brandId"='used';
 BEGIN
  DELETE FROM brands WHERE id='used';
  RAISE EXCEPTION 'Expected FK violation';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;
SELECT 'Migration constraints passed' AS result;
ROLLBACK;
