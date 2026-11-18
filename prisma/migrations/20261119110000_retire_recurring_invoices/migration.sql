-- Retire periodic invoice templates. Service records have no provenance FK to
-- these templates, so ordinary service records/payments must not be guessed at
-- or deleted by this migration.
DROP TABLE "public"."recurring_parts";
DROP TABLE "public"."recurring_labor";
DROP TABLE "public"."recurring_invoices";
