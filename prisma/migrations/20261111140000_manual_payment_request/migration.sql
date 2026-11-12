ALTER TABLE "payments" ADD COLUMN "requestId" TEXT;
CREATE UNIQUE INDEX "payments_serviceRecordId_requestId_key" ON "payments" ("serviceRecordId", "requestId");
