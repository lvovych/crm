ALTER TABLE inventory_documents
 ADD COLUMN "additionalCost" numeric(20,2) NOT NULL DEFAULT 0,
 ADD COLUMN "roundingAdjustment" numeric(20,2) NOT NULL DEFAULT 0,
 ADD COLUMN "roundingReason" text NOT NULL DEFAULT '',
 ADD COLUMN "sourceTotal" numeric(20,2),
 ADD COLUMN "costAllocationMethod" text NOT NULL DEFAULT 'PROPORTIONAL',
 ADD CONSTRAINT receipt_cost_valid CHECK ("additionalCost">=0 AND abs("roundingAdjustment")<=0.01 AND ("roundingAdjustment"=0 OR length(trim("roundingReason"))>=5) AND "costAllocationMethod" IN ('PROPORTIONAL','MANUAL'));
ALTER TABLE inventory_document_lines ADD COLUMN "additionalCostAmount" numeric(20,2) NOT NULL DEFAULT 0 CHECK ("additionalCostAmount">=0);
