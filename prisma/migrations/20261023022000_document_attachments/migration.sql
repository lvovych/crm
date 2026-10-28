CREATE TABLE ledger_attachments (
 id TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,"createdById" TEXT REFERENCES users(id) ON DELETE SET NULL,"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "inventoryDocumentId" TEXT,"supplierServiceDocumentId" TEXT,"moneyTransactionId" TEXT,
 name TEXT NOT NULL,"mimeType" TEXT NOT NULL,size integer NOT NULL CHECK(size>0 AND size<=10485760),sha256 TEXT NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),"storageKey" TEXT NOT NULL UNIQUE,
 UNIQUE("organizationId",id),
 CHECK(num_nonnulls("inventoryDocumentId","supplierServiceDocumentId","moneyTransactionId")=1),
 FOREIGN KEY("organizationId","inventoryDocumentId") REFERENCES inventory_documents("organizationId",id) ON DELETE RESTRICT,
 FOREIGN KEY("organizationId","supplierServiceDocumentId") REFERENCES supplier_service_documents("organizationId",id) ON DELETE RESTRICT,
 FOREIGN KEY("organizationId","moneyTransactionId") REFERENCES money_transactions("organizationId",id) ON DELETE RESTRICT
);
CREATE INDEX ledger_attachments_inventory ON ledger_attachments("organizationId","inventoryDocumentId");
CREATE INDEX ledger_attachments_subcontract ON ledger_attachments("organizationId","supplierServiceDocumentId");
CREATE INDEX ledger_attachments_money ON ledger_attachments("organizationId","moneyTransactionId");
CREATE TRIGGER ledger_attachment_immutable BEFORE UPDATE OR DELETE ON ledger_attachments FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
