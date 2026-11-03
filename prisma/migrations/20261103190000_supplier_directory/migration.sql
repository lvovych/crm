-- AlterTable
ALTER TABLE "inventory_parts" ADD COLUMN     "preferredSupplierId" TEXT;

-- CreateTable
CREATE TABLE "counterparties" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'company',
    "country" TEXT NOT NULL DEFAULT 'UA',
    "taxId" TEXT,
    "address" TEXT,
    "website" TEXT,
    "notes" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "counterparties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_profiles" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "counterpartyId" TEXT NOT NULL,
    "suppliesParts" BOOLEAN NOT NULL DEFAULT true,
    "suppliesServices" BOOLEAN NOT NULL DEFAULT false,
    "paymentTermDays" INTEGER,
    "paymentTerms" TEXT,

    CONSTRAINT "supplier_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counterparty_contacts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "counterpartyId" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "counterparty_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counterparty_bank_accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "counterpartyId" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "bankName" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'UAH',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "counterparty_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counterparty_source_links" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "counterpartyId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceAccountId" TEXT NOT NULL,
    "externalSupplierId" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3),
    "snapshotAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "counterparty_source_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_import_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'carbook',
    "sourceAccountId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL,
    "checksum" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'preview',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summary" JSONB NOT NULL,

    CONSTRAINT "supplier_import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_import_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "externalSupplierId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "conflicts" JSONB NOT NULL,

    CONSTRAINT "supplier_import_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "counterparties_organizationId_isArchived_name_idx" ON "counterparties"("organizationId", "isArchived", "name");

-- CreateIndex
CREATE INDEX "counterparties_organizationId_taxId_idx" ON "counterparties"("organizationId", "taxId");

-- CreateIndex
CREATE UNIQUE INDEX "counterparties_organizationId_id_key" ON "counterparties"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_profiles_counterpartyId_key" ON "supplier_profiles"("counterpartyId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_profiles_organizationId_counterpartyId_key" ON "supplier_profiles"("organizationId", "counterpartyId");

-- CreateIndex
CREATE INDEX "counterparty_contacts_organizationId_counterpartyId_idx" ON "counterparty_contacts"("organizationId", "counterpartyId");

-- CreateIndex
CREATE INDEX "counterparty_bank_accounts_organizationId_counterpartyId_idx" ON "counterparty_bank_accounts"("organizationId", "counterpartyId");

-- CreateIndex
CREATE UNIQUE INDEX "counterparty_source_links_organizationId_source_sourceAccou_key" ON "counterparty_source_links"("organizationId", "source", "sourceAccountId", "externalSupplierId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_import_runs_organizationId_id_key" ON "supplier_import_runs"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_import_runs_organizationId_sourceAccountId_checksu_key" ON "supplier_import_runs"("organizationId", "sourceAccountId", "checksum");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_import_items_runId_externalSupplierId_key" ON "supplier_import_items"("runId", "externalSupplierId");

-- AddForeignKey
ALTER TABLE "inventory_parts" ADD CONSTRAINT "inventory_parts_organizationId_preferredSupplierId_fkey" FOREIGN KEY ("organizationId", "preferredSupplierId") REFERENCES "counterparties"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparties" ADD CONSTRAINT "counterparties_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_profiles" ADD CONSTRAINT "supplier_profiles_organizationId_counterpartyId_fkey" FOREIGN KEY ("organizationId", "counterpartyId") REFERENCES "counterparties"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparty_contacts" ADD CONSTRAINT "counterparty_contacts_organizationId_counterpartyId_fkey" FOREIGN KEY ("organizationId", "counterpartyId") REFERENCES "counterparties"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparty_bank_accounts" ADD CONSTRAINT "counterparty_bank_accounts_organizationId_counterpartyId_fkey" FOREIGN KEY ("organizationId", "counterpartyId") REFERENCES "counterparties"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparty_source_links" ADD CONSTRAINT "counterparty_source_links_organizationId_counterpartyId_fkey" FOREIGN KEY ("organizationId", "counterpartyId") REFERENCES "counterparties"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_import_runs" ADD CONSTRAINT "supplier_import_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_import_items" ADD CONSTRAINT "supplier_import_items_organizationId_runId_fkey" FOREIGN KEY ("organizationId", "runId") REFERENCES "supplier_import_runs"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Directory integrity also holds for imports and administrative writes.
ALTER TABLE "supplier_profiles" ADD CONSTRAINT "supplier_payment_term_nonnegative" CHECK ("paymentTermDays" IS NULL OR "paymentTermDays" BETWEEN 0 AND 3650);
ALTER TABLE "supplier_profiles" ADD CONSTRAINT "supplier_has_specialization" CHECK ("suppliesParts" OR "suppliesServices");
ALTER TABLE "inventory_parts" ADD CONSTRAINT "preferred_supplier_requires_organization" CHECK ("preferredSupplierId" IS NULL OR "organizationId" IS NOT NULL);
CREATE INDEX "inventory_preferred_supplier_idx" ON "inventory_parts" ("organizationId", "preferredSupplierId");
CREATE UNIQUE INDEX "counterparty_primary_contact" ON "counterparty_contacts" ("organizationId", "counterpartyId") WHERE "isPrimary";
CREATE UNIQUE INDEX "counterparty_primary_bank" ON "counterparty_bank_accounts" ("organizationId", "counterpartyId") WHERE "isPrimary";
