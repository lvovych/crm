CREATE INDEX "receipt_return_search_idx" ON "supplier_receipts" ("organizationId", "supplierId", "status", "receivedDate" DESC, "id");
CREATE INDEX "return_list_page_idx" ON "supplier_returns" ("organizationId", "createdAt" DESC, "id");
CREATE INDEX "return_supplier_page_idx" ON "supplier_returns" ("organizationId", "supplierId", "createdAt" DESC, "id");
CREATE INDEX "return_line_availability_idx" ON "supplier_return_lines" ("lineId");
