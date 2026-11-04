-- AlterTable
ALTER TABLE "supplier_receipt_lines" ADD COLUMN     "article" TEXT;

-- CreateTable
CREATE TABLE "supplier_articles" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "article" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "partId" TEXT NOT NULL,

    CONSTRAINT "supplier_articles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_articles_partId_idx" ON "supplier_articles"("partId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_articles_organizationId_supplierId_normalized_key" ON "supplier_articles"("organizationId", "supplierId", "normalized");

-- AddForeignKey
ALTER TABLE "supplier_articles" ADD CONSTRAINT "supplier_articles_organizationId_supplierId_fkey" FOREIGN KEY ("organizationId", "supplierId") REFERENCES "counterparties"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_articles" ADD CONSTRAINT "supplier_articles_partId_fkey" FOREIGN KEY ("partId") REFERENCES "inventory_parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

