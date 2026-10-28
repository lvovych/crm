CREATE TABLE customer_adjustments (
 id text PRIMARY KEY, "organizationId" text NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 "createdById" text REFERENCES users(id) ON DELETE SET NULL, "createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "serviceRecordId" text NOT NULL, number text NOT NULL, kind text NOT NULL CHECK(kind IN ('CREDIT','DEBIT')),
 amount numeric(20,2) NOT NULL CHECK(amount>0), "effectiveAt" date NOT NULL, reason text NOT NULL CHECK(length(btrim(reason))>=5),
 UNIQUE("organizationId",id), UNIQUE("organizationId",number),
 FOREIGN KEY("organizationId","serviceRecordId") REFERENCES service_records("organizationId",id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX customer_adjustments_work_order ON customer_adjustments("organizationId","serviceRecordId","effectiveAt");
ALTER TABLE settlement_entries ADD COLUMN "customerAdjustmentId" text;
ALTER TABLE settlement_entries ADD CONSTRAINT customer_adjustment_source_fk FOREIGN KEY("organizationId","customerAdjustmentId") REFERENCES customer_adjustments("organizationId",id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE settlement_entries DROP CONSTRAINT settlement_source;
ALTER TABLE settlement_entries ADD CONSTRAINT settlement_source CHECK(num_nonnulls("inventoryDocumentId","moneyTransactionId","openingBalanceId","supplierServiceDocumentId","serviceRecordId","customerAdjustmentId")=1);
CREATE TRIGGER customer_adjustment_immutable BEFORE UPDATE OR DELETE ON customer_adjustments FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
