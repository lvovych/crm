-- AlterTable
ALTER TABLE "service_records" ADD COLUMN     "financeAccountingMode" TEXT NOT NULL DEFAULT 'LEGACY',
ADD COLUMN     "inventoryAccountingMode" TEXT NOT NULL DEFAULT 'LEGACY';

-- AlterTable
ALTER TABLE "service_parts" ADD COLUMN     "organizationId" TEXT;

-- CreateTable
CREATE TABLE "stock_demands" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "requiredQty" DECIMAL(18,3) NOT NULL,
    "ownership" TEXT NOT NULL DEFAULT 'OWN',
    "state" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "servicePartId" TEXT NOT NULL,
    "serviceRecordId" TEXT NOT NULL,
    "inventoryPartId" TEXT NOT NULL,

    CONSTRAINT "stock_demands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdQuantity" DECIMAL(18,3) NOT NULL,
    "remainingQuantity" DECIMAL(18,3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "demandId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservation_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "kind" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "effectiveAt" DATE NOT NULL,
    "operationKey" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "documentLineId" TEXT,

    CONSTRAINT "reservation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_lot_allocations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unitCostSnapshot" DECIMAL(20,6) NOT NULL,
    "documentLineId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "demandId" TEXT,
    "sourceIssueAllocationId" TEXT,

    CONSTRAINT "document_lot_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_demands_organizationId_servicePartId_key" ON "stock_demands"("organizationId", "servicePartId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_demands_organizationId_id_key" ON "stock_demands"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_reservations_organizationId_id_key" ON "stock_reservations"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "reservation_events_organizationId_operationKey_key" ON "reservation_events"("organizationId", "operationKey");

-- CreateIndex
CREATE UNIQUE INDEX "reservation_events_organizationId_id_key" ON "reservation_events"("organizationId", "id");

-- CreateIndex
CREATE INDEX "document_lot_allocations_organizationId_demandId_idx" ON "document_lot_allocations"("organizationId", "demandId");

-- CreateIndex
CREATE UNIQUE INDEX "document_lot_allocations_organizationId_id_key" ON "document_lot_allocations"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "service_records_organizationId_id_key" ON "service_records"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "service_parts_organizationId_id_key" ON "service_parts"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "stock_demands" ADD CONSTRAINT "stock_demands_organizationId_servicePartId_fkey" FOREIGN KEY ("organizationId", "servicePartId") REFERENCES "service_parts"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_demands" ADD CONSTRAINT "stock_demands_organizationId_serviceRecordId_fkey" FOREIGN KEY ("organizationId", "serviceRecordId") REFERENCES "service_records"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_demands" ADD CONSTRAINT "stock_demands_organizationId_inventoryPartId_fkey" FOREIGN KEY ("organizationId", "inventoryPartId") REFERENCES "inventory_parts"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_demands" ADD CONSTRAINT "stock_demands_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_demands" ADD CONSTRAINT "stock_demands_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_organizationId_demandId_fkey" FOREIGN KEY ("organizationId", "demandId") REFERENCES "stock_demands"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_organizationId_lotId_fkey" FOREIGN KEY ("organizationId", "lotId") REFERENCES "stock_lots"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_organizationId_warehouseId_fkey" FOREIGN KEY ("organizationId", "warehouseId") REFERENCES "warehouses"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_events" ADD CONSTRAINT "reservation_events_organizationId_reservationId_fkey" FOREIGN KEY ("organizationId", "reservationId") REFERENCES "stock_reservations"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "reservation_events" ADD CONSTRAINT "reservation_events_organizationId_documentLineId_fkey" FOREIGN KEY ("organizationId", "documentLineId") REFERENCES "inventory_document_lines"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "reservation_events" ADD CONSTRAINT "reservation_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_events" ADD CONSTRAINT "reservation_events_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_lot_allocations" ADD CONSTRAINT "document_lot_allocations_organizationId_documentLineId_fkey" FOREIGN KEY ("organizationId", "documentLineId") REFERENCES "inventory_document_lines"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "document_lot_allocations" ADD CONSTRAINT "document_lot_allocations_organizationId_lotId_fkey" FOREIGN KEY ("organizationId", "lotId") REFERENCES "stock_lots"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "document_lot_allocations" ADD CONSTRAINT "document_lot_allocations_organizationId_warehouseId_fkey" FOREIGN KEY ("organizationId", "warehouseId") REFERENCES "warehouses"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "document_lot_allocations" ADD CONSTRAINT "document_lot_allocations_organizationId_demandId_fkey" FOREIGN KEY ("organizationId", "demandId") REFERENCES "stock_demands"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "document_lot_allocations" ADD CONSTRAINT "document_lot_allocations_organizationId_sourceIssueAllocat_fkey" FOREIGN KEY ("organizationId", "sourceIssueAllocationId") REFERENCES "document_lot_allocations"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "document_lot_allocations" ADD CONSTRAINT "document_lot_allocations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_lot_allocations" ADD CONSTRAINT "document_lot_allocations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


UPDATE service_parts p SET "organizationId"=s."organizationId" FROM service_records s WHERE s.id=p."serviceRecordId";
CREATE FUNCTION service_part_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org text;
BEGIN
 SELECT "organizationId" INTO org FROM service_records WHERE id=NEW."serviceRecordId";
 IF NEW."organizationId" IS NOT NULL AND NEW."organizationId" IS DISTINCT FROM org THEN RAISE EXCEPTION 'Invalid part organization'; END IF;
 NEW."organizationId"=org;
 RETURN NEW;
END $$;
CREATE TRIGGER service_part_tenant BEFORE INSERT OR UPDATE ON service_parts FOR EACH ROW EXECUTE FUNCTION service_part_tenant();
ALTER TABLE stock_demands ADD CONSTRAINT demand_quantity CHECK("requiredQty">0 AND ownership IN ('OWN','CUSTOMER') AND state IN ('ACTIVE','CANCELLED'));
ALTER TABLE stock_reservations ADD CONSTRAINT reservation_quantity CHECK("createdQuantity">0 AND "remainingQuantity">=0 AND "remainingQuantity"<="createdQuantity");
ALTER TABLE reservation_events ADD CONSTRAINT reservation_event_valid CHECK(quantity>0 AND kind IN ('RESERVE','RELEASE','CONSUME'));
ALTER TABLE document_lot_allocations ADD CONSTRAINT lot_allocation_valid CHECK(quantity>0 AND "unitCostSnapshot">=0 AND id IS DISTINCT FROM "sourceIssueAllocationId");
CREATE TRIGGER reservation_event_immutable BEFORE UPDATE OR DELETE ON reservation_events FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
CREATE TRIGGER lot_allocation_immutable BEFORE UPDATE OR DELETE ON document_lot_allocations FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
ALTER TABLE service_records ADD CONSTRAINT inventory_accounting_mode CHECK("inventoryAccountingMode" IN ('LEGACY','LEDGER')), ADD CONSTRAINT finance_accounting_mode CHECK("financeAccountingMode" IN ('LEGACY','LEDGER'));
