CREATE TABLE subcontract_work (
  "laborId" text PRIMARY KEY REFERENCES service_labor(id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  "supplierId" text NOT NULL REFERENCES counterparties(id) ON DELETE RESTRICT,
  "unitCost" numeric(14,4) NOT NULL CHECK ("unitCost" >= 0),
  "receiptLineId" text UNIQUE REFERENCES supplier_receipt_lines(id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
