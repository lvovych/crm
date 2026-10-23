-- Preserve the actual issued value independently of the rounded unit price.
-- Legacy allocations used quantity * unitCostSnapshot for every journal entry.
BEGIN;
ALTER TABLE document_lot_allocations ADD COLUMN "costAmountSnapshot" DECIMAL(20,6);
ALTER TABLE document_lot_allocations DISABLE TRIGGER lot_allocation_immutable;
UPDATE document_lot_allocations SET "costAmountSnapshot" = ROUND(quantity * "unitCostSnapshot", 6);
ALTER TABLE document_lot_allocations ENABLE TRIGGER lot_allocation_immutable;
ALTER TABLE document_lot_allocations ALTER COLUMN "costAmountSnapshot" SET NOT NULL;
ALTER TABLE document_lot_allocations ADD CONSTRAINT allocation_cost_nonnegative CHECK ("costAmountSnapshot" >= 0);
COMMIT;
