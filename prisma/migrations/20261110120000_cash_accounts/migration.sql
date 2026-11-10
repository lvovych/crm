-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "amountExact" DECIMAL(22,2);

-- CreateTable
CREATE TABLE "finance_settings" (
    "organizationId" TEXT NOT NULL,
    "activatedOn" DATE,
    "activatedAt" TIMESTAMP(3),
    "activatedById" TEXT,
    "closedThrough" DATE,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "finance_settings_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "own_legal_entities" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxId" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "own_legal_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "money_accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'UAH',
    "iban" TEXT,
    "bankName" TEXT,
    "allowNegative" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "money_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "money_account_access" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "canRead" BOOLEAN NOT NULL DEFAULT true,
    "canPost" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "money_account_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_flow_categories" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "systemCode" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "cash_flow_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_documents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "date" DATE NOT NULL,
    "amount" DECIMAL(22,2) NOT NULL,
    "sourceAccountId" TEXT,
    "targetAccountId" TEXT,
    "categoryId" TEXT,
    "counterpartyLabel" TEXT,
    "note" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "reversalOfId" TEXT,
    "originalId" TEXT,
    "paymentId" TEXT,
    "supplierEntryId" TEXT,

    CONSTRAINT "financial_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "money_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(22,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "money_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_cutover_batches" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "balances" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "finance_cutover_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "own_legal_entities_organizationId_id_key" ON "own_legal_entities"("organizationId", "id");

-- CreateIndex
CREATE INDEX "money_accounts_organizationId_isArchived_idx" ON "money_accounts"("organizationId", "isArchived");

-- CreateIndex
CREATE UNIQUE INDEX "money_accounts_organizationId_id_key" ON "money_accounts"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "money_account_access_accountId_roleId_key" ON "money_account_access"("accountId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "cash_flow_categories_organizationId_id_key" ON "cash_flow_categories"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_flow_categories_organizationId_systemCode_key" ON "cash_flow_categories"("organizationId", "systemCode");

-- CreateIndex
CREATE UNIQUE INDEX "financial_documents_reversalOfId_key" ON "financial_documents"("reversalOfId");

-- CreateIndex
CREATE UNIQUE INDEX "financial_documents_paymentId_key" ON "financial_documents"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "financial_documents_supplierEntryId_key" ON "financial_documents"("supplierEntryId");

-- CreateIndex
CREATE INDEX "financial_documents_organizationId_date_idx" ON "financial_documents"("organizationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "financial_documents_organizationId_id_key" ON "financial_documents"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_documents_organizationId_requestId_key" ON "financial_documents"("organizationId", "requestId");

-- CreateIndex
CREATE INDEX "money_entries_organizationId_accountId_date_idx" ON "money_entries"("organizationId", "accountId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "money_entries_documentId_accountId_key" ON "money_entries"("documentId", "accountId");

-- CreateIndex
CREATE INDEX "finance_cutover_batches_organizationId_status_idx" ON "finance_cutover_batches"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "finance_settings" ADD CONSTRAINT "finance_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "own_legal_entities" ADD CONSTRAINT "own_legal_entities_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_accounts" ADD CONSTRAINT "money_accounts_organizationId_legalEntityId_fkey" FOREIGN KEY ("organizationId", "legalEntityId") REFERENCES "own_legal_entities"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_account_access" ADD CONSTRAINT "money_account_access_organizationId_accountId_fkey" FOREIGN KEY ("organizationId", "accountId") REFERENCES "money_accounts"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_account_access" ADD CONSTRAINT "money_account_access_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_flow_categories" ADD CONSTRAINT "cash_flow_categories_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_documents" ADD CONSTRAINT "financial_documents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_documents" ADD CONSTRAINT "financial_documents_organizationId_sourceAccountId_fkey" FOREIGN KEY ("organizationId", "sourceAccountId") REFERENCES "money_accounts"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_documents" ADD CONSTRAINT "financial_documents_organizationId_targetAccountId_fkey" FOREIGN KEY ("organizationId", "targetAccountId") REFERENCES "money_accounts"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_documents" ADD CONSTRAINT "financial_documents_organizationId_categoryId_fkey" FOREIGN KEY ("organizationId", "categoryId") REFERENCES "cash_flow_categories"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_documents" ADD CONSTRAINT "financial_documents_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "financial_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_documents" ADD CONSTRAINT "financial_documents_originalId_fkey" FOREIGN KEY ("originalId") REFERENCES "financial_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_documents" ADD CONSTRAINT "financial_documents_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_documents" ADD CONSTRAINT "financial_documents_supplierEntryId_fkey" FOREIGN KEY ("supplierEntryId") REFERENCES "supplier_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_entries" ADD CONSTRAINT "money_entries_organizationId_documentId_fkey" FOREIGN KEY ("organizationId", "documentId") REFERENCES "financial_documents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_entries" ADD CONSTRAINT "money_entries_organizationId_accountId_fkey" FOREIGN KEY ("organizationId", "accountId") REFERENCES "money_accounts"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_cutover_batches" ADD CONSTRAINT "finance_cutover_batches_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Posted ledger rows are append-only, including direct SQL and cascade paths.
CREATE FUNCTION finance_reject_entry_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Posted money entries are immutable; use a reversal'; END $$;
CREATE TRIGGER immutable_money_entry BEFORE UPDATE OR DELETE ON money_entries
FOR EACH ROW EXECUTE FUNCTION finance_reject_entry_mutation();
CREATE FUNCTION finance_protect_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'posted' THEN RAISE EXCEPTION 'Posted financial documents are immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_posted_document BEFORE UPDATE OR DELETE ON financial_documents
FOR EACH ROW EXECUTE FUNCTION finance_protect_document();
CREATE FUNCTION finance_protect_payment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM financial_documents WHERE "paymentId" = OLD.id AND status='posted') THEN
    RAISE EXCEPTION 'Linked payment is immutable; use a financial reversal';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_linked_payment BEFORE UPDATE OR DELETE ON payments
FOR EACH ROW EXECUTE FUNCTION finance_protect_payment();
ALTER TABLE money_accounts ADD CONSTRAINT money_account_kind CHECK (kind IN ('cash','bank'));
ALTER TABLE money_accounts ADD CONSTRAINT money_account_currency CHECK (currency='UAH');
ALTER TABLE money_accounts ADD CONSTRAINT cash_cannot_overdraw CHECK (kind<>'cash' OR NOT "allowNegative");
ALTER TABLE financial_documents ADD CONSTRAINT finance_nonnegative_amount CHECK (amount>=0);
ALTER TABLE financial_documents ADD CONSTRAINT finance_status CHECK (status IN ('draft','pending','posted'));
