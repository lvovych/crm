ALTER TABLE supplier_return_lines ADD COLUMN "brandSnapshot" TEXT, ADD COLUMN "articleSnapshot" TEXT;
UPDATE supplier_return_lines r SET "articleSnapshot"=coalesce(nullif(l.article,''),p."partNumber"), "brandSnapshot"=b.name
FROM supplier_receipt_lines l LEFT JOIN inventory_parts p ON p.id=l."partId" LEFT JOIN brands b ON b.id=p."brandId"
WHERE r."lineId"=l.id;
ALTER TABLE supplier_returns ADD COLUMN "supplierId" TEXT;
UPDATE supplier_returns d SET "supplierId"=r."supplierId" FROM supplier_receipts r WHERE r.id=d."receiptId";
ALTER TABLE supplier_returns ALTER COLUMN "supplierId" SET NOT NULL, ALTER COLUMN "receiptId" DROP NOT NULL;
ALTER TABLE supplier_returns ADD CONSTRAINT supplier_returns_supplier_fk FOREIGN KEY ("organizationId","supplierId") REFERENCES counterparties("organizationId",id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX supplier_returns_supplier_idx ON supplier_returns("organizationId","supplierId");
