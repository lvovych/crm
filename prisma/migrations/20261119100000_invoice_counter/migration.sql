CREATE TABLE "public"."invoice_counters" (
  "organizationId" TEXT PRIMARY KEY REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "lastNumber" TEXT NOT NULL CHECK ("lastNumber" ~ '^[0-9]+$')
);
