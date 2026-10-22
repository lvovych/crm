-- AlterTable
ALTER TABLE "service_records" ADD COLUMN     "ledgerFinancialSnapshot" JSONB;

-- AlterTable
ALTER TABLE "service_labor" ADD COLUMN     "executionType" TEXT NOT NULL DEFAULT 'INTERNAL';

-- AlterTable
ALTER TABLE "money_transactions" ADD COLUMN     "reversalOfId" TEXT;

-- AlterTable
ALTER TABLE "cash_ledger_entries" ADD COLUMN     "openingBalanceId" TEXT,
ALTER COLUMN "moneyTransactionId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "settlement_entries" ADD COLUMN     "openingBalanceId" TEXT,
ADD COLUMN     "reversalOfId" TEXT,
ADD COLUMN     "serviceRecordId" TEXT,
ADD COLUMN     "supplierServiceDocumentId" TEXT;

-- CreateTable
CREATE TABLE "document_sequences" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "kind" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
    "allocationId" TEXT NOT NULL,

    CONSTRAINT "allocation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_service_documents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "number" TEXT NOT NULL,
    "externalNumber" TEXT,
    "effectiveAt" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "currency" CHAR(3) NOT NULL DEFAULT 'UAH',
    "totalAmount" DECIMAL(20,2) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supplierId" TEXT NOT NULL,

    CONSTRAINT "supplier_service_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_service_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "descriptionSnapshot" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unitCost" DECIMAL(20,6) NOT NULL,
    "totalAmount" DECIMAL(20,2) NOT NULL,
    "documentId" TEXT NOT NULL,
    "serviceRecordId" TEXT NOT NULL,

    CONSTRAINT "supplier_service_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opening_balances" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "side" TEXT,
    "polarity" TEXT,
    "amount" DECIMAL(20,2) NOT NULL,
    "asOfDate" DATE NOT NULL,
    "sourceNote" TEXT NOT NULL,
    "batchKey" TEXT NOT NULL,
    "partyId" TEXT,
    "accountId" TEXT,

    CONSTRAINT "opening_balances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_sequences_organizationId_kind_year_key" ON "document_sequences"("organizationId", "kind", "year");

-- CreateIndex
CREATE UNIQUE INDEX "document_sequences_organizationId_id_key" ON "document_sequences"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "allocation_events_organizationId_id_key" ON "allocation_events"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_service_documents_organizationId_number_key" ON "supplier_service_documents"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_service_documents_organizationId_id_key" ON "supplier_service_documents"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_service_lines_organizationId_id_key" ON "supplier_service_lines"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "opening_balances_organizationId_batchKey_key" ON "opening_balances"("organizationId", "batchKey");

-- CreateIndex
CREATE UNIQUE INDEX "opening_balances_organizationId_id_key" ON "opening_balances"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "money_transactions" ADD CONSTRAINT "money_transactions_organizationId_reversalOfId_fkey" FOREIGN KEY ("organizationId", "reversalOfId") REFERENCES "money_transactions"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "cash_ledger_entries" ADD CONSTRAINT "cash_ledger_entries_organizationId_openingBalanceId_fkey" FOREIGN KEY ("organizationId", "openingBalanceId") REFERENCES "opening_balances"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "settlement_entries" ADD CONSTRAINT "settlement_entries_organizationId_openingBalanceId_fkey" FOREIGN KEY ("organizationId", "openingBalanceId") REFERENCES "opening_balances"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "settlement_entries" ADD CONSTRAINT "settlement_entries_organizationId_supplierServiceDocumentI_fkey" FOREIGN KEY ("organizationId", "supplierServiceDocumentId") REFERENCES "supplier_service_documents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "settlement_entries" ADD CONSTRAINT "settlement_entries_organizationId_serviceRecordId_fkey" FOREIGN KEY ("organizationId", "serviceRecordId") REFERENCES "service_records"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "settlement_entries" ADD CONSTRAINT "settlement_entries_organizationId_reversalOfId_fkey" FOREIGN KEY ("organizationId", "reversalOfId") REFERENCES "settlement_entries"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_events" ADD CONSTRAINT "allocation_events_organizationId_allocationId_fkey" FOREIGN KEY ("organizationId", "allocationId") REFERENCES "settlement_allocations"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "allocation_events" ADD CONSTRAINT "allocation_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_events" ADD CONSTRAINT "allocation_events_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_service_documents" ADD CONSTRAINT "supplier_service_documents_organizationId_supplierId_fkey" FOREIGN KEY ("organizationId", "supplierId") REFERENCES "suppliers"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "supplier_service_documents" ADD CONSTRAINT "supplier_service_documents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_service_documents" ADD CONSTRAINT "supplier_service_documents_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_service_lines" ADD CONSTRAINT "supplier_service_lines_organizationId_documentId_fkey" FOREIGN KEY ("organizationId", "documentId") REFERENCES "supplier_service_documents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "supplier_service_lines" ADD CONSTRAINT "supplier_service_lines_organizationId_serviceRecordId_fkey" FOREIGN KEY ("organizationId", "serviceRecordId") REFERENCES "service_records"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "supplier_service_lines" ADD CONSTRAINT "supplier_service_lines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_service_lines" ADD CONSTRAINT "supplier_service_lines_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_balances" ADD CONSTRAINT "opening_balances_organizationId_partyId_fkey" FOREIGN KEY ("organizationId", "partyId") REFERENCES "settlement_parties"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "opening_balances" ADD CONSTRAINT "opening_balances_organizationId_accountId_fkey" FOREIGN KEY ("organizationId", "accountId") REFERENCES "cash_accounts"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "opening_balances" ADD CONSTRAINT "opening_balances_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_balances" ADD CONSTRAINT "opening_balances_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE settlement_entries DROP CONSTRAINT settlement_source;
ALTER TABLE settlement_entries ADD CONSTRAINT settlement_source CHECK(num_nonnulls("inventoryDocumentId","moneyTransactionId","openingBalanceId","supplierServiceDocumentId","serviceRecordId")=1);
ALTER TABLE cash_ledger_entries ADD CONSTRAINT cash_source CHECK(num_nonnulls("moneyTransactionId","openingBalanceId")=1);
ALTER TABLE opening_balances ADD CONSTRAINT opening_source CHECK(amount>0 AND (("partyId" IS NOT NULL AND "accountId" IS NULL AND side IN ('AR','AP') AND polarity IN ('DEBIT','CREDIT')) OR ("partyId" IS NULL AND "accountId" IS NOT NULL AND side IS NULL AND polarity IS NULL)));
CREATE UNIQUE INDEX payment_one_reversal ON money_transactions("organizationId","reversalOfId") WHERE "reversalOfId" IS NOT NULL;
CREATE UNIQUE INDEX charge_once ON settlement_entries("organizationId","serviceRecordId") WHERE "serviceRecordId" IS NOT NULL AND "reversalOfId" IS NULL;
CREATE UNIQUE INDEX subcontract_external_unique ON supplier_service_documents("organizationId","supplierId","externalNumber","effectiveAt") WHERE "externalNumber" IS NOT NULL;
ALTER TABLE supplier_service_lines ADD CONSTRAINT service_line_positive CHECK(quantity>0 AND "unitCost">=0 AND "totalAmount">=0);
ALTER TABLE supplier_service_documents ADD CONSTRAINT service_document_positive CHECK("totalAmount">0 AND currency='UAH');
CREATE TRIGGER subcontract_immutable BEFORE UPDATE OR DELETE ON supplier_service_documents FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
CREATE TRIGGER subcontract_line_immutable BEFORE UPDATE OR DELETE ON supplier_service_lines FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
CREATE TRIGGER opening_immutable BEFORE UPDATE OR DELETE ON opening_balances FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
CREATE TRIGGER allocation_event_immutable BEFORE UPDATE OR DELETE ON allocation_events FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
CREATE FUNCTION record_allocation_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO allocation_events(id,"organizationId","createdById",kind,amount,"effectiveAt","allocationId") VALUES(gen_random_uuid()::text,NEW."organizationId",NEW."createdById",CASE WHEN TG_OP='INSERT' THEN 'APPLY' ELSE 'REVERSE' END,NEW.amount,CASE WHEN TG_OP='INSERT' THEN NEW."effectiveAt" ELSE NEW."reversedAt" END,NEW.id);
 RETURN NEW;
END $$;
CREATE TRIGGER allocation_event AFTER INSERT OR UPDATE ON settlement_allocations FOR EACH ROW EXECUTE FUNCTION record_allocation_event();
