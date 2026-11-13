-- CreateTable
CREATE TABLE "StaffAllocation" (
    "id" TEXT NOT NULL,
    "slipId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffAllocation_slipId_paymentId_key" ON "StaffAllocation"("slipId", "paymentId");

-- AddForeignKey
ALTER TABLE "StaffAllocation" ADD CONSTRAINT "StaffAllocation_slipId_fkey" FOREIGN KEY ("slipId") REFERENCES "PaySlip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAllocation" ADD CONSTRAINT "StaffAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "StaffPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
