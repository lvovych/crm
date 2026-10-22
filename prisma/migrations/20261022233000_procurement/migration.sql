-- AlterTable
ALTER TABLE "inventory_document_lines" ADD COLUMN     "purchaseOrderLineId" TEXT;

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "expectedAt" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    "supplierId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "qtyOrdered" DECIMAL(18,3) NOT NULL,
    "qtyCancelled" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "quotedUnitPrice" DECIMAL(20,6) NOT NULL,
    "snapshotName" TEXT NOT NULL,
    "snapshotBrand" TEXT NOT NULL,
    "snapshotArticle" TEXT,
    "snapshotUnit" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "orderId" TEXT NOT NULL,
    "inventoryPartId" TEXT NOT NULL,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_demand_allocations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "quantity" DECIMAL(18,3) NOT NULL,
    "fulfilledQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "purchaseOrderLineId" TEXT NOT NULL,
    "demandId" TEXT NOT NULL,

    CONSTRAINT "purchase_demand_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_demand_allocations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "quantity" DECIMAL(18,3) NOT NULL,
    "receiptLineId" TEXT NOT NULL,
    "demandId" TEXT NOT NULL,
    "purchaseAllocationId" TEXT,

    CONSTRAINT "receipt_demand_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_import_jobs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "fileHash" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "sourceName" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "supplierId" TEXT NOT NULL,
    "documentId" TEXT,

    CONSTRAINT "ledger_import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_organizationId_number_key" ON "purchase_orders"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_organizationId_id_key" ON "purchase_orders"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_lines_organizationId_id_key" ON "purchase_order_lines"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_demand_allocations_organizationId_purchaseOrderLin_key" ON "purchase_demand_allocations"("organizationId", "purchaseOrderLineId", "demandId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_demand_allocations_organizationId_id_key" ON "purchase_demand_allocations"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_demand_allocations_organizationId_receiptLineId_dem_key" ON "receipt_demand_allocations"("organizationId", "receiptLineId", "demandId");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_demand_allocations_organizationId_id_key" ON "receipt_demand_allocations"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_import_jobs_organizationId_supplierId_fileHash_key" ON "ledger_import_jobs"("organizationId", "supplierId", "fileHash");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_import_jobs_organizationId_id_key" ON "ledger_import_jobs"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "inventory_document_lines" ADD CONSTRAINT "inventory_document_lines_organizationId_purchaseOrderLineI_fkey" FOREIGN KEY ("organizationId", "purchaseOrderLineId") REFERENCES "purchase_order_lines"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_organizationId_supplierId_fkey" FOREIGN KEY ("organizationId", "supplierId") REFERENCES "suppliers"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_organizationId_warehouseId_fkey" FOREIGN KEY ("organizationId", "warehouseId") REFERENCES "warehouses"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_organizationId_orderId_fkey" FOREIGN KEY ("organizationId", "orderId") REFERENCES "purchase_orders"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_organizationId_inventoryPartId_fkey" FOREIGN KEY ("organizationId", "inventoryPartId") REFERENCES "inventory_parts"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_demand_allocations" ADD CONSTRAINT "purchase_demand_allocations_organizationId_purchaseOrderLi_fkey" FOREIGN KEY ("organizationId", "purchaseOrderLineId") REFERENCES "purchase_order_lines"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_demand_allocations" ADD CONSTRAINT "purchase_demand_allocations_organizationId_demandId_fkey" FOREIGN KEY ("organizationId", "demandId") REFERENCES "stock_demands"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_demand_allocations" ADD CONSTRAINT "purchase_demand_allocations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_demand_allocations" ADD CONSTRAINT "purchase_demand_allocations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_demand_allocations" ADD CONSTRAINT "receipt_demand_allocations_organizationId_receiptLineId_fkey" FOREIGN KEY ("organizationId", "receiptLineId") REFERENCES "inventory_document_lines"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receipt_demand_allocations" ADD CONSTRAINT "receipt_demand_allocations_organizationId_demandId_fkey" FOREIGN KEY ("organizationId", "demandId") REFERENCES "stock_demands"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receipt_demand_allocations" ADD CONSTRAINT "receipt_demand_allocations_organizationId_purchaseAllocati_fkey" FOREIGN KEY ("organizationId", "purchaseAllocationId") REFERENCES "purchase_demand_allocations"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receipt_demand_allocations" ADD CONSTRAINT "receipt_demand_allocations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_demand_allocations" ADD CONSTRAINT "receipt_demand_allocations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_import_jobs" ADD CONSTRAINT "ledger_import_jobs_organizationId_supplierId_fkey" FOREIGN KEY ("organizationId", "supplierId") REFERENCES "suppliers"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ledger_import_jobs" ADD CONSTRAINT "ledger_import_jobs_organizationId_documentId_fkey" FOREIGN KEY ("organizationId", "documentId") REFERENCES "inventory_documents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ledger_import_jobs" ADD CONSTRAINT "ledger_import_jobs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_import_jobs" ADD CONSTRAINT "ledger_import_jobs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE purchase_orders ADD CONSTRAINT purchase_status CHECK(status IN ('DRAFT','CONFIRMED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED'));
ALTER TABLE purchase_order_lines ADD CONSTRAINT purchase_quantity CHECK("qtyOrdered">0 AND "qtyCancelled">=0 AND "qtyCancelled"<="qtyOrdered" AND "quotedUnitPrice">=0);
ALTER TABLE purchase_demand_allocations ADD CONSTRAINT purchase_allocation_quantity CHECK(quantity>0 AND "fulfilledQty">=0 AND "fulfilledQty"<=quantity);
ALTER TABLE receipt_demand_allocations ADD CONSTRAINT receipt_allocation_quantity CHECK(quantity>0);
