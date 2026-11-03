-- Every supplier can provide both parts and services. There is no specialization.
ALTER TABLE "supplier_profiles" DROP CONSTRAINT "supplier_has_specialization";
ALTER TABLE "supplier_profiles" DROP COLUMN "suppliesParts", DROP COLUMN "suppliesServices";
ALTER TABLE "counterparties" ALTER COLUMN "kind" SET DEFAULT 'unknown';
