-- AlterTable
ALTER TABLE "subcontract_work" ADD COLUMN     "returnedCost" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "supplier_entries" ADD COLUMN     "returnId" TEXT;

-- CreateTable
CREATE TABLE "supplier_returns" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_return_lines" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "supplier_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_returns_organizationId_date_idx" ON "supplier_returns"("organizationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_return_lines_returnId_lineId_key" ON "supplier_return_lines"("returnId", "lineId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_entries_returnId_key" ON "supplier_entries"("returnId");

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "supplier_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "supplier_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "supplier_receipt_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_entries" ADD CONSTRAINT "supplier_entries_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "supplier_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE supplier_entries DROP CONSTRAINT supplier_entry_kind,
ADD CONSTRAINT supplier_entry_kind CHECK (kind IN (
  'receipt','payment','opening_debt','opening_credit','adjustment_debt','adjustment_credit','return_credit'
));
ALTER TABLE supplier_entries DROP CONSTRAINT supplier_entry_amount,
ADD CONSTRAINT supplier_entry_amount CHECK (amount >= 0 AND (kind IN ('receipt','return_credit') OR amount > 0));
ALTER TABLE supplier_return_lines ADD CONSTRAINT supplier_return_quantity CHECK (quantity > 0),
ADD CONSTRAINT supplier_return_amount CHECK (amount >= 0);

DROP INDEX "stock_movements_receiptLineId_reason_key";
CREATE UNIQUE INDEX "stock_movements_receiptLineId_reason_key" ON stock_movements ("receiptLineId", reason)
WHERE reason <> 'supplier_return';
CREATE INDEX "stock_movements_receiptLineId_reason_idx" ON stock_movements ("receiptLineId", reason);
