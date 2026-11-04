-- CreateTable
CREATE TABLE "supplier_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "receiptId" TEXT,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(22,2) NOT NULL,
    "date" DATE NOT NULL,
    "due" DATE,
    "method" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),
    "reversedById" TEXT,
    "reason" TEXT,

    CONSTRAINT "supplier_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_allocations" (
    "id" TEXT NOT NULL,
    "creditId" TEXT NOT NULL,
    "debitId" TEXT NOT NULL,
    "amount" DECIMAL(22,2) NOT NULL,
    "date" DATE NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),
    "reversedById" TEXT,
    "reason" TEXT,

    CONSTRAINT "supplier_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_entries_receiptId_key" ON "supplier_entries"("receiptId");

-- CreateIndex
CREATE INDEX "supplier_entries_organizationId_supplierId_date_idx" ON "supplier_entries"("organizationId", "supplierId", "date");

-- CreateIndex
CREATE INDEX "supplier_allocations_creditId_idx" ON "supplier_allocations"("creditId");

-- CreateIndex
CREATE INDEX "supplier_allocations_debitId_idx" ON "supplier_allocations"("debitId");

-- AddForeignKey
ALTER TABLE "supplier_entries" ADD CONSTRAINT "supplier_entries_organizationId_supplierId_fkey" FOREIGN KEY ("organizationId", "supplierId") REFERENCES "counterparties"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_entries" ADD CONSTRAINT "supplier_entries_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "supplier_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_allocations" ADD CONSTRAINT "supplier_allocations_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "supplier_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_allocations" ADD CONSTRAINT "supplier_allocations_debitId_fkey" FOREIGN KEY ("debitId") REFERENCES "supplier_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE supplier_entries ADD CONSTRAINT supplier_entry_amount CHECK (amount >= 0 AND (kind='receipt' OR amount>0)), ADD CONSTRAINT supplier_entry_kind CHECK (kind IN ('receipt','payment','opening_debt','opening_credit'));
ALTER TABLE supplier_allocations ADD CONSTRAINT supplier_allocation_amount CHECK (amount>0 AND "creditId"<>"debitId");
CREATE UNIQUE INDEX supplier_opening_once ON supplier_entries ("organizationId","supplierId") WHERE kind IN ('opening_debt','opening_credit') AND "reversedAt" IS NULL;
