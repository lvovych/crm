-- Do not discard historical documents to resolve duplicates. Operators must
-- reconcile conflicting numbers before this migration can be applied.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM supplier_receipts GROUP BY "organizationId", number HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate supplier receipt numbers: reconcile them before applying the unique-number migration';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_receipts_organizationId_number_key" ON "supplier_receipts"("organizationId", "number");
DROP INDEX "supplier_receipts_organizationId_supplierId_number_document_key";
ALTER TABLE "supplier_receipt_lines" ADD COLUMN "brandSnapshot" TEXT;
