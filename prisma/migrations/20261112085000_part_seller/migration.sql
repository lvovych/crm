ALTER TABLE service_parts ADD COLUMN "payrollSellerId" TEXT REFERENCES technicians(id) ON DELETE RESTRICT;
ALTER TABLE "PayAssignment" ADD CONSTRAINT "PayAssignment_partsId_fkey" FOREIGN KEY ("partsId") REFERENCES technicians(id) ON DELETE RESTRICT;
ALTER TABLE "PayAssignment" ADD CONSTRAINT "PayAssignment_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES technicians(id) ON DELETE RESTRICT;
