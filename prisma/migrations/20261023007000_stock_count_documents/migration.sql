-- CreateTable
CREATE TABLE "ledger_stock_counts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshotAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveAt" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COUNTING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "warehouseId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "adjustmentDocumentId" TEXT,

    CONSTRAINT "ledger_stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_stock_count_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "inventoryPartId" TEXT NOT NULL,
    "lotId" TEXT,
    "expectedQty" DECIMAL(18,3) NOT NULL,
    "countedQty" DECIMAL(18,3),
    "snapshotVersion" INTEGER,
    "confirmedUnitCost" DECIMAL(20,6),
    "reason" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ledger_stock_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ledger_stock_counts_organizationId_createdAt_idx" ON "ledger_stock_counts"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_stock_counts_organizationId_id_key" ON "ledger_stock_counts"("organizationId", "id");

-- CreateIndex
CREATE INDEX "ledger_stock_count_lines_organizationId_countId_idx" ON "ledger_stock_count_lines"("organizationId", "countId");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_stock_count_lines_organizationId_id_key" ON "ledger_stock_count_lines"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "ledger_stock_counts" ADD CONSTRAINT "ledger_stock_counts_organizationId_warehouseId_fkey" FOREIGN KEY ("organizationId", "warehouseId") REFERENCES "warehouses"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ledger_stock_counts" ADD CONSTRAINT "ledger_stock_counts_organizationId_adjustmentDocumentId_fkey" FOREIGN KEY ("organizationId", "adjustmentDocumentId") REFERENCES "inventory_documents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ledger_stock_count_lines" ADD CONSTRAINT "ledger_stock_count_lines_organizationId_countId_fkey" FOREIGN KEY ("organizationId", "countId") REFERENCES "ledger_stock_counts"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ledger_stock_count_lines" ADD CONSTRAINT "ledger_stock_count_lines_organizationId_inventoryPartId_fkey" FOREIGN KEY ("organizationId", "inventoryPartId") REFERENCES "inventory_parts"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ledger_stock_count_lines" ADD CONSTRAINT "ledger_stock_count_lines_organizationId_lotId_fkey" FOREIGN KEY ("organizationId", "lotId") REFERENCES "stock_lots"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;


ALTER TABLE ledger_stock_counts ADD CONSTRAINT count_org_fk FOREIGN KEY ("organizationId") REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE ledger_stock_counts ADD CONSTRAINT count_actor_fk FOREIGN KEY ("createdById") REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE ledger_stock_counts ADD CONSTRAINT count_status CHECK(status IN ('COUNTING','POSTED','CANCELLED') AND (status <> 'POSTED' OR "adjustmentDocumentId" IS NOT NULL));
ALTER TABLE ledger_stock_count_lines ADD CONSTRAINT count_quantity CHECK("expectedQty">=0 AND ("countedQty" IS NULL OR "countedQty">=0) AND ("confirmedUnitCost" IS NULL OR "confirmedUnitCost">=0));
CREATE UNIQUE INDEX count_lot_unique ON ledger_stock_count_lines("organizationId","countId","lotId") WHERE "lotId" IS NOT NULL;
CREATE TRIGGER stock_count_immutable BEFORE UPDATE OR DELETE ON ledger_stock_counts FOR EACH ROW WHEN (OLD.status <> 'COUNTING') EXECUTE FUNCTION ledger_immutable();
CREATE FUNCTION stock_count_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP <> 'INSERT' AND EXISTS(SELECT 1 FROM ledger_stock_counts WHERE id=OLD."countId" AND status <> 'COUNTING') THEN RAISE EXCEPTION 'Stock count is immutable'; END IF;
 IF TG_OP <> 'DELETE' AND EXISTS(SELECT 1 FROM ledger_stock_counts WHERE id=NEW."countId" AND status <> 'COUNTING') THEN RAISE EXCEPTION 'Stock count is immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER stock_count_line_guard BEFORE INSERT OR UPDATE OR DELETE ON ledger_stock_count_lines FOR EACH ROW EXECUTE FUNCTION stock_count_line_guard();
