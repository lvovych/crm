-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'GOODS',
    "countryCode" TEXT NOT NULL DEFAULT 'UA',
    "taxId" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 0,
    "bankDetails" JSONB,
    "notes" TEXT,
    "archivedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "reservable" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_documents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "number" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "effectiveAt" DATE NOT NULL,
    "postedAt" TIMESTAMPTZ(3),
    "externalNumber" TEXT,
    "externalDate" DATE,
    "dueDate" DATE,
    "currency" CHAR(3) NOT NULL DEFAULT 'UAH',
    "subtotal" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supplierId" TEXT,
    "sourceWarehouseId" TEXT,
    "targetWarehouseId" TEXT,
    "sourceDocumentId" TEXT,

    CONSTRAINT "inventory_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_document_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unitPrice" DECIMAL(20,6) NOT NULL,
    "discountType" TEXT NOT NULL DEFAULT 'NONE',
    "discountValue" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(20,2) NOT NULL,
    "taxMode" TEXT NOT NULL DEFAULT 'NONE',
    "taxRate" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(20,2) NOT NULL,
    "taxAmount" DECIMAL(20,2) NOT NULL,
    "totalAmount" DECIMAL(20,2) NOT NULL,
    "snapshotName" TEXT NOT NULL,
    "snapshotBrand" TEXT NOT NULL,
    "snapshotArticle" TEXT,
    "snapshotUnit" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "documentId" TEXT NOT NULL,
    "inventoryPartId" TEXT NOT NULL,

    CONSTRAINT "inventory_document_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_lots" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "acquiredAt" DATE NOT NULL,
    "unitCost" DECIMAL(20,6) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'UAH',
    "sourceLineId" TEXT NOT NULL,
    "inventoryPartId" TEXT NOT NULL,

    CONSTRAINT "stock_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_lot_balances" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "onHandQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "reservedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "lotId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,

    CONSTRAINT "stock_lot_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_ledger_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "quantityDelta" DECIMAL(18,3) NOT NULL,
    "costAmountDelta" DECIMAL(20,6) NOT NULL,
    "effectiveAt" DATE NOT NULL,
    "operationKey" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "documentLineId" TEXT NOT NULL,

    CONSTRAINT "inventory_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_parties" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "kind" TEXT NOT NULL,
    "displayNameSnapshot" TEXT NOT NULL,
    "supplierId" TEXT,
    "customerId" TEXT,

    CONSTRAINT "settlement_parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'BANK',
    "currency" CHAR(3) NOT NULL DEFAULT 'UAH',
    "archivedAt" TIMESTAMPTZ(3),

    CONSTRAINT "cash_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "money_transactions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "direction" TEXT NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'UAH',
    "effectiveAt" DATE NOT NULL,
    "method" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "partyId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,

    CONSTRAINT "money_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_ledger_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "amountDelta" DECIMAL(20,2) NOT NULL,
    "effectiveAt" DATE NOT NULL,
    "operationKey" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "moneyTransactionId" TEXT NOT NULL,

    CONSTRAINT "cash_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "side" TEXT NOT NULL,
    "polarity" TEXT NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'UAH',
    "effectiveAt" DATE NOT NULL,
    "dueDate" DATE,
    "operationKey" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "inventoryDocumentId" TEXT,
    "moneyTransactionId" TEXT,

    CONSTRAINT "settlement_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_allocations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "amount" DECIMAL(20,2) NOT NULL,
    "effectiveAt" DATE NOT NULL,
    "reversedAt" TIMESTAMPTZ(3),
    "reversalReason" TEXT,
    "operationKey" TEXT NOT NULL,
    "debitEntryId" TEXT NOT NULL,
    "creditEntryId" TEXT NOT NULL,

    CONSTRAINT "settlement_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_audit_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "ledger_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_commands" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "response" JSONB NOT NULL,

    CONSTRAINT "ledger_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_period_locks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "inventoryClosedThrough" DATE,
    "financeClosedThrough" DATE,
    "reason" TEXT NOT NULL,

    CONSTRAINT "accounting_period_locks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_organizationId_id_key" ON "suppliers"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_organizationId_code_key" ON "warehouses"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_organizationId_id_key" ON "warehouses"("organizationId", "id");

-- CreateIndex
CREATE INDEX "inventory_documents_organizationId_effectiveAt_id_idx" ON "inventory_documents"("organizationId", "effectiveAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_documents_organizationId_number_key" ON "inventory_documents"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_documents_organizationId_id_key" ON "inventory_documents"("organizationId", "id");

-- CreateIndex
CREATE INDEX "inventory_document_lines_organizationId_documentId_idx" ON "inventory_document_lines"("organizationId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_document_lines_organizationId_id_key" ON "inventory_document_lines"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_lots_organizationId_sourceLineId_key" ON "stock_lots"("organizationId", "sourceLineId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_lots_organizationId_id_key" ON "stock_lots"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_lot_balances_organizationId_lotId_warehouseId_key" ON "stock_lot_balances"("organizationId", "lotId", "warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_lot_balances_organizationId_id_key" ON "stock_lot_balances"("organizationId", "id");

-- CreateIndex
CREATE INDEX "inventory_ledger_entries_organizationId_lotId_warehouseId_e_idx" ON "inventory_ledger_entries"("organizationId", "lotId", "warehouseId", "effectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_ledger_entries_organizationId_operationKey_key" ON "inventory_ledger_entries"("organizationId", "operationKey");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_ledger_entries_organizationId_id_key" ON "inventory_ledger_entries"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_parties_organizationId_supplierId_key" ON "settlement_parties"("organizationId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_parties_organizationId_customerId_key" ON "settlement_parties"("organizationId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_parties_organizationId_id_key" ON "settlement_parties"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_accounts_organizationId_id_key" ON "cash_accounts"("organizationId", "id");

-- CreateIndex
CREATE INDEX "money_transactions_organizationId_effectiveAt_id_idx" ON "money_transactions"("organizationId", "effectiveAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "money_transactions_organizationId_id_key" ON "money_transactions"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_ledger_entries_organizationId_operationKey_key" ON "cash_ledger_entries"("organizationId", "operationKey");

-- CreateIndex
CREATE UNIQUE INDEX "cash_ledger_entries_organizationId_id_key" ON "cash_ledger_entries"("organizationId", "id");

-- CreateIndex
CREATE INDEX "settlement_entries_organizationId_partyId_side_effectiveAt_idx" ON "settlement_entries"("organizationId", "partyId", "side", "effectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_entries_organizationId_operationKey_key" ON "settlement_entries"("organizationId", "operationKey");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_entries_organizationId_id_key" ON "settlement_entries"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_allocations_organizationId_operationKey_key" ON "settlement_allocations"("organizationId", "operationKey");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_allocations_organizationId_id_key" ON "settlement_allocations"("organizationId", "id");

-- CreateIndex
CREATE INDEX "ledger_audit_events_organizationId_entityType_entityId_idx" ON "ledger_audit_events"("organizationId", "entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_audit_events_organizationId_id_key" ON "ledger_audit_events"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_commands_organizationId_scope_key_key" ON "ledger_commands"("organizationId", "scope", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_commands_organizationId_id_key" ON "ledger_commands"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_period_locks_organizationId_key" ON "accounting_period_locks"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_period_locks_organizationId_id_key" ON "accounting_period_locks"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_organizationId_id_key" ON "customers"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_parts_organizationId_id_key" ON "inventory_parts"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_documents" ADD CONSTRAINT "inventory_documents_organizationId_supplierId_fkey" FOREIGN KEY ("organizationId", "supplierId") REFERENCES "suppliers"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "inventory_documents" ADD CONSTRAINT "inventory_documents_organizationId_sourceWarehouseId_fkey" FOREIGN KEY ("organizationId", "sourceWarehouseId") REFERENCES "warehouses"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "inventory_documents" ADD CONSTRAINT "inventory_documents_organizationId_targetWarehouseId_fkey" FOREIGN KEY ("organizationId", "targetWarehouseId") REFERENCES "warehouses"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "inventory_documents" ADD CONSTRAINT "inventory_documents_organizationId_sourceDocumentId_fkey" FOREIGN KEY ("organizationId", "sourceDocumentId") REFERENCES "inventory_documents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "inventory_documents" ADD CONSTRAINT "inventory_documents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_documents" ADD CONSTRAINT "inventory_documents_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_document_lines" ADD CONSTRAINT "inventory_document_lines_organizationId_documentId_fkey" FOREIGN KEY ("organizationId", "documentId") REFERENCES "inventory_documents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "inventory_document_lines" ADD CONSTRAINT "inventory_document_lines_organizationId_inventoryPartId_fkey" FOREIGN KEY ("organizationId", "inventoryPartId") REFERENCES "inventory_parts"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "inventory_document_lines" ADD CONSTRAINT "inventory_document_lines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_document_lines" ADD CONSTRAINT "inventory_document_lines_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_organizationId_sourceLineId_fkey" FOREIGN KEY ("organizationId", "sourceLineId") REFERENCES "inventory_document_lines"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_organizationId_inventoryPartId_fkey" FOREIGN KEY ("organizationId", "inventoryPartId") REFERENCES "inventory_parts"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lot_balances" ADD CONSTRAINT "stock_lot_balances_organizationId_lotId_fkey" FOREIGN KEY ("organizationId", "lotId") REFERENCES "stock_lots"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_lot_balances" ADD CONSTRAINT "stock_lot_balances_organizationId_warehouseId_fkey" FOREIGN KEY ("organizationId", "warehouseId") REFERENCES "warehouses"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_lot_balances" ADD CONSTRAINT "stock_lot_balances_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lot_balances" ADD CONSTRAINT "stock_lot_balances_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_ledger_entries" ADD CONSTRAINT "inventory_ledger_entries_organizationId_lotId_fkey" FOREIGN KEY ("organizationId", "lotId") REFERENCES "stock_lots"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "inventory_ledger_entries" ADD CONSTRAINT "inventory_ledger_entries_organizationId_warehouseId_fkey" FOREIGN KEY ("organizationId", "warehouseId") REFERENCES "warehouses"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "inventory_ledger_entries" ADD CONSTRAINT "inventory_ledger_entries_organizationId_documentLineId_fkey" FOREIGN KEY ("organizationId", "documentLineId") REFERENCES "inventory_document_lines"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "inventory_ledger_entries" ADD CONSTRAINT "inventory_ledger_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_ledger_entries" ADD CONSTRAINT "inventory_ledger_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_parties" ADD CONSTRAINT "settlement_parties_organizationId_supplierId_fkey" FOREIGN KEY ("organizationId", "supplierId") REFERENCES "suppliers"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "settlement_parties" ADD CONSTRAINT "settlement_parties_organizationId_customerId_fkey" FOREIGN KEY ("organizationId", "customerId") REFERENCES "customers"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "settlement_parties" ADD CONSTRAINT "settlement_parties_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_parties" ADD CONSTRAINT "settlement_parties_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_transactions" ADD CONSTRAINT "money_transactions_organizationId_partyId_fkey" FOREIGN KEY ("organizationId", "partyId") REFERENCES "settlement_parties"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "money_transactions" ADD CONSTRAINT "money_transactions_organizationId_accountId_fkey" FOREIGN KEY ("organizationId", "accountId") REFERENCES "cash_accounts"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "money_transactions" ADD CONSTRAINT "money_transactions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_transactions" ADD CONSTRAINT "money_transactions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_ledger_entries" ADD CONSTRAINT "cash_ledger_entries_organizationId_accountId_fkey" FOREIGN KEY ("organizationId", "accountId") REFERENCES "cash_accounts"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "cash_ledger_entries" ADD CONSTRAINT "cash_ledger_entries_organizationId_moneyTransactionId_fkey" FOREIGN KEY ("organizationId", "moneyTransactionId") REFERENCES "money_transactions"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "cash_ledger_entries" ADD CONSTRAINT "cash_ledger_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_ledger_entries" ADD CONSTRAINT "cash_ledger_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_entries" ADD CONSTRAINT "settlement_entries_organizationId_partyId_fkey" FOREIGN KEY ("organizationId", "partyId") REFERENCES "settlement_parties"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "settlement_entries" ADD CONSTRAINT "settlement_entries_organizationId_inventoryDocumentId_fkey" FOREIGN KEY ("organizationId", "inventoryDocumentId") REFERENCES "inventory_documents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "settlement_entries" ADD CONSTRAINT "settlement_entries_organizationId_moneyTransactionId_fkey" FOREIGN KEY ("organizationId", "moneyTransactionId") REFERENCES "money_transactions"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "settlement_entries" ADD CONSTRAINT "settlement_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_entries" ADD CONSTRAINT "settlement_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_allocations" ADD CONSTRAINT "settlement_allocations_organizationId_debitEntryId_fkey" FOREIGN KEY ("organizationId", "debitEntryId") REFERENCES "settlement_entries"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "settlement_allocations" ADD CONSTRAINT "settlement_allocations_organizationId_creditEntryId_fkey" FOREIGN KEY ("organizationId", "creditEntryId") REFERENCES "settlement_entries"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "settlement_allocations" ADD CONSTRAINT "settlement_allocations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_allocations" ADD CONSTRAINT "settlement_allocations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_audit_events" ADD CONSTRAINT "ledger_audit_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_audit_events" ADD CONSTRAINT "ledger_audit_events_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_commands" ADD CONSTRAINT "ledger_commands_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_commands" ADD CONSTRAINT "ledger_commands_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_period_locks" ADD CONSTRAINT "accounting_period_locks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_period_locks" ADD CONSTRAINT "accounting_period_locks_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Domain checks complement the tenant-scoped foreign keys generated above.
ALTER TABLE suppliers ADD CONSTRAINT suppliers_terms CHECK ("paymentTermsDays" BETWEEN 0 AND 365), ADD CONSTRAINT suppliers_kind CHECK (kind IN ('GOODS','SERVICES','BOTH'));
CREATE UNIQUE INDEX suppliers_tax_id ON suppliers ("organizationId", "countryCode", "taxId") WHERE "taxId" IS NOT NULL AND "taxId" <> '';
CREATE UNIQUE INDEX warehouses_one_default ON warehouses ("organizationId") WHERE "isDefault" AND "archivedAt" IS NULL;
CREATE UNIQUE INDEX receipt_external_identity ON inventory_documents ("organizationId", "supplierId", "externalNumber", "externalDate", kind) WHERE "externalNumber" IS NOT NULL AND status <> 'CANCELLED';
ALTER TABLE inventory_documents ADD CONSTRAINT inventory_document_status CHECK (status IN ('DRAFT','POSTED','CANCELLED','REVERSED')), ADD CONSTRAINT inventory_document_currency CHECK (currency='UAH'), ADD CONSTRAINT receipt_required CHECK (kind <> 'RECEIPT' OR ("supplierId" IS NOT NULL AND "targetWarehouseId" IS NOT NULL)), ADD CONSTRAINT document_totals CHECK ("totalAmount"="subtotal"+"taxAmount" AND "totalAmount">=0), ADD CONSTRAINT document_version CHECK(version>0);
ALTER TABLE inventory_document_lines ADD CONSTRAINT line_amounts CHECK (quantity>0 AND "unitPrice">=0 AND "discountValue">=0 AND "netAmount">=0 AND "taxAmount">=0 AND "totalAmount"="netAmount"+"taxAmount"), ADD CONSTRAINT line_tax CHECK ("taxMode" IN ('NONE','INCLUSIVE','EXCLUSIVE') AND "taxRate" BETWEEN 0 AND 100), ADD CONSTRAINT line_discount CHECK ("discountType" IN ('NONE','PERCENT','AMOUNT') AND ("discountType"<>'PERCENT' OR "discountValue"<=100));
ALTER TABLE stock_lot_balances ADD CONSTRAINT balance_nonnegative CHECK ("onHandQty">=0 AND "reservedQty">=0 AND "reservedQty"<="onHandQty");
ALTER TABLE stock_lots ADD CONSTRAINT lot_cost CHECK ("unitCost">=0 AND currency='UAH');
ALTER TABLE inventory_ledger_entries ADD CONSTRAINT movement_nonzero CHECK ("quantityDelta"<>0);
ALTER TABLE settlement_parties ADD CONSTRAINT party_exact_source CHECK ((kind='SUPPLIER' AND "supplierId" IS NOT NULL AND "customerId" IS NULL) OR (kind='CUSTOMER' AND "customerId" IS NOT NULL AND "supplierId" IS NULL));
ALTER TABLE cash_accounts ADD CONSTRAINT account_currency CHECK (currency='UAH'), ADD CONSTRAINT account_kind CHECK (kind IN ('CASH','BANK','CARD_CLEARING'));
ALTER TABLE money_transactions ADD CONSTRAINT payment_valid CHECK (amount>0 AND currency='UAH' AND direction IN ('IN','OUT') AND status IN ('POSTED','REVERSED'));
ALTER TABLE settlement_entries ADD CONSTRAINT settlement_valid CHECK (amount>0 AND currency='UAH' AND side IN ('AR','AP') AND polarity IN ('DEBIT','CREDIT')), ADD CONSTRAINT settlement_source CHECK (num_nonnulls("inventoryDocumentId","moneyTransactionId")=1);
ALTER TABLE settlement_allocations ADD CONSTRAINT allocation_valid CHECK (amount>0 AND "debitEntryId"<>"creditEntryId");

CREATE FUNCTION ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Posted ledger records are immutable'; END $$;
CREATE TRIGGER stock_ledger_immutable BEFORE UPDATE OR DELETE ON inventory_ledger_entries FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
CREATE TRIGGER cash_ledger_immutable BEFORE UPDATE OR DELETE ON cash_ledger_entries FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
CREATE TRIGGER settlement_immutable BEFORE UPDATE OR DELETE ON settlement_entries FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
CREATE TRIGGER lot_immutable BEFORE UPDATE OR DELETE ON stock_lots FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
CREATE TRIGGER ledger_audit_immutable BEFORE UPDATE OR DELETE ON ledger_audit_events FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
CREATE TRIGGER ledger_command_immutable BEFORE UPDATE OR DELETE ON ledger_commands FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
CREATE FUNCTION inventory_document_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'Posted documents are immutable'; END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER inventory_document_immutable BEFORE UPDATE OR DELETE ON inventory_documents FOR EACH ROW EXECUTE FUNCTION inventory_document_guard();
CREATE FUNCTION inventory_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE state text;
BEGIN
 IF TG_OP <> 'INSERT' THEN
  SELECT status INTO state FROM inventory_documents WHERE id=OLD."documentId" AND "organizationId"=OLD."organizationId" FOR SHARE;
  IF state <> 'DRAFT' THEN RAISE EXCEPTION 'Posted document lines are immutable'; END IF;
 END IF;
 IF TG_OP <> 'DELETE' THEN
  SELECT status INTO state FROM inventory_documents WHERE id=NEW."documentId" AND "organizationId"=NEW."organizationId" FOR SHARE;
  IF state <> 'DRAFT' THEN RAISE EXCEPTION 'Posted document lines are immutable'; END IF;
  RETURN NEW;
 END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER inventory_line_immutable BEFORE INSERT OR UPDATE OR DELETE ON inventory_document_lines FOR EACH ROW EXECUTE FUNCTION inventory_line_guard();
