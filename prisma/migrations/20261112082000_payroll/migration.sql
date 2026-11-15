-- CreateTable
CREATE TABLE "PayPlan" (
    "id" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "effective" DATE NOT NULL,
    "frequency" TEXT NOT NULL,
    "monthly" DECIMAL(14,2) NOT NULL,
    "labor" DECIMAL(6,2) NOT NULL,
    "partsSales" DECIMAL(6,2) NOT NULL,
    "partsMargin" DECIMAL(6,2) NOT NULL,
    "orderMargin" DECIMAL(6,2) NOT NULL,
    "afterDiscount" BOOLEAN NOT NULL DEFAULT true,
    "marginAfterDiscount" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PayPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaySlip" (
    "id" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "start" DATE NOT NULL,
    "end" DATE NOT NULL,
    "lines" JSONB NOT NULL,
    "total" DECIMAL(16,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,

    CONSTRAINT "PaySlip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffPayment" (
    "id" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "advance" BOOLEAN NOT NULL,

    CONSTRAINT "StaffPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayAssignment" (
    "orderId" TEXT NOT NULL,
    "partsId" TEXT,
    "ownerId" TEXT,

    CONSTRAINT "PayAssignment_pkey" PRIMARY KEY ("orderId")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayPlan_technicianId_effective_key" ON "PayPlan"("technicianId", "effective");

-- CreateIndex
CREATE UNIQUE INDEX "PaySlip_technicianId_start_key" ON "PaySlip"("technicianId", "start");

-- CreateIndex
CREATE UNIQUE INDEX "StaffPayment_documentId_key" ON "StaffPayment"("documentId");

-- AddForeignKey
ALTER TABLE "PayPlan" ADD CONSTRAINT "PayPlan_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "technicians"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaySlip" ADD CONSTRAINT "PaySlip_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "technicians"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffPayment" ADD CONSTRAINT "StaffPayment_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "technicians"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffPayment" ADD CONSTRAINT "StaffPayment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "financial_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayAssignment" ADD CONSTRAINT "PayAssignment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "service_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
