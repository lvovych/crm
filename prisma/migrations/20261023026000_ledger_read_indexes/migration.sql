-- Bounded product history and document tabs at production-sized journal volumes.
CREATE INDEX ledger_history_page ON inventory_ledger_entries("organizationId","lotId","warehouseId","effectiveAt" DESC,"createdAt" DESC,id DESC);
CREATE INDEX ledger_lot_product ON stock_lots("organizationId","inventoryPartId",id);
CREATE INDEX ledger_supplier_documents_page ON inventory_documents("organizationId","supplierId","createdAt" DESC,id DESC);
CREATE INDEX ledger_supplier_services_page ON supplier_service_documents("organizationId","supplierId","createdAt" DESC,id DESC);
CREATE INDEX ledger_party_payments_page ON money_transactions("organizationId","partyId","createdAt" DESC,id DESC);
