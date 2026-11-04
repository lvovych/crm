-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "receiptLineId" TEXT;

-- CreateTable
CREATE TABLE "supplier_receipts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "documentDate" DATE NOT NULL,
    "receivedDate" DATE NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'UAH',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sourceAccount" TEXT,
    "externalId" TEXT,

    CONSTRAINT "supplier_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_receipt_lines" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(14,4) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "partId" TEXT,

    CONSTRAINT "supplier_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_receipts_organizationId_receivedDate_idx" ON "supplier_receipts"("organizationId", "receivedDate");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_receipts_organizationId_supplierId_number_document_key" ON "supplier_receipts"("organizationId", "supplierId", "number", "documentDate");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_receipts_organizationId_source_sourceAccount_exter_key" ON "supplier_receipts"("organizationId", "source", "sourceAccount", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_receipt_lines_receiptId_position_key" ON "supplier_receipt_lines"("receiptId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_receiptLineId_reason_key" ON "stock_movements"("receiptLineId", "reason");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_receiptLineId_fkey" FOREIGN KEY ("receiptLineId") REFERENCES "supplier_receipt_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_receipts" ADD CONSTRAINT "supplier_receipts_organizationId_supplierId_fkey" FOREIGN KEY ("organizationId", "supplierId") REFERENCES "counterparties"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_receipt_lines" ADD CONSTRAINT "supplier_receipt_lines_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "supplier_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_receipt_lines" ADD CONSTRAINT "supplier_receipt_lines_partId_fkey" FOREIGN KEY ("partId") REFERENCES "inventory_parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

