CREATE TABLE "receipt_transfers" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "lineId" TEXT NOT NULL REFERENCES "supplier_receipt_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "requestId" TEXT NOT NULL,
 "requestHash" TEXT NOT NULL,
 "serviceRecordId" TEXT NOT NULL,
 "serviceRecordLabel" TEXT NOT NULL,
 "vehicleId" TEXT,
 "servicePartId" TEXT NOT NULL,
 "quantity" DECIMAL(14,3) NOT NULL CHECK ("quantity" > 0),
 "unitPrice" DECIMAL(14,4) NOT NULL CHECK ("unitPrice" >= 0),
 "createdById" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "receipt_transfers_requestId_lineId_key" ON "receipt_transfers"("requestId", "lineId");
CREATE INDEX "receipt_transfers_lineId_idx" ON "receipt_transfers"("lineId");
