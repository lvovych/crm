CREATE TABLE units_of_measure (
 id text PRIMARY KEY, "organizationId" text NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 "createdById" text REFERENCES users(id) ON DELETE SET NULL, "createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 code text NOT NULL, name text NOT NULL, precision integer NOT NULL CHECK(precision BETWEEN 0 AND 3), version integer NOT NULL DEFAULT 1,
 "archivedAt" timestamptz(3), UNIQUE("organizationId",id), UNIQUE("organizationId",code)
);
CREATE TABLE warehouse_locations (
 id text PRIMARY KEY, "organizationId" text NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 "createdById" text REFERENCES users(id) ON DELETE SET NULL, "createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "warehouseId" text NOT NULL, code text NOT NULL, name text NOT NULL, version integer NOT NULL DEFAULT 1,
 "archivedAt" timestamptz(3), UNIQUE("organizationId",id), UNIQUE("organizationId","warehouseId",code),
 FOREIGN KEY("organizationId","warehouseId") REFERENCES warehouses("organizationId",id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE supplier_products (
 id text PRIMARY KEY, "organizationId" text NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 "createdById" text REFERENCES users(id) ON DELETE SET NULL, "createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "supplierId" text NOT NULL, "inventoryPartId" text NOT NULL, "supplierArticle" text, "lastQuotedPrice" numeric(20,6), currency char(3) NOT NULL DEFAULT 'UAH',
 "leadTimeDays" integer, preferred boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1, "archivedAt" timestamptz(3),
 UNIQUE("organizationId",id), UNIQUE("organizationId","supplierId","inventoryPartId"),
 CHECK(currency='UAH' AND ("lastQuotedPrice" IS NULL OR "lastQuotedPrice">=0) AND ("leadTimeDays" IS NULL OR "leadTimeDays" BETWEEN 0 AND 365)),
 FOREIGN KEY("organizationId","supplierId") REFERENCES suppliers("organizationId",id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("organizationId","inventoryPartId") REFERENCES inventory_parts("organizationId",id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX supplier_product_preferred ON supplier_products("organizationId","inventoryPartId") WHERE preferred AND "archivedAt" IS NULL;
ALTER TABLE inventory_parts ADD COLUMN "unitId" text, ADD COLUMN "locationId" text, ADD COLUMN "trackingMode" text NOT NULL DEFAULT 'STOCK';
ALTER TABLE inventory_parts ADD CONSTRAINT product_tracking_mode CHECK("trackingMode" IN ('STOCK','NON_STOCK')),
 ADD CONSTRAINT product_measure_unit_fk FOREIGN KEY("organizationId","unitId") REFERENCES units_of_measure("organizationId",id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 ADD CONSTRAINT product_location_fk FOREIGN KEY("organizationId","locationId") REFERENCES warehouse_locations("organizationId",id) ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX ledger_product_normalized_article ON inventory_parts("organizationId","brandId",(regexp_replace(upper(normalize(COALESCE("partNumber",''),NFKC)),'[[:space:]./_-]','','g')));
CREATE INDEX ledger_supplier_normalized_article ON supplier_products("organizationId","supplierId",(regexp_replace(upper(normalize(COALESCE("supplierArticle",''),NFKC)),'[[:space:]./_-]','','g')));
CREATE FUNCTION ledger_product_unit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.unit,NEW."unitId",NEW."trackingMode") IS DISTINCT FROM ROW(OLD.unit,OLD."unitId",OLD."trackingMode")
 AND (EXISTS(SELECT 1 FROM stock_lots WHERE "inventoryPartId"=OLD.id AND "organizationId"=OLD."organizationId")
 OR EXISTS(SELECT 1 FROM stock_demands WHERE "inventoryPartId"=OLD.id AND state='ACTIVE')
 OR EXISTS(SELECT 1 FROM purchase_order_lines l JOIN purchase_orders o ON o.id=l."orderId" WHERE l."inventoryPartId"=OLD.id AND o.status IN ('DRAFT','CONFIRMED','PARTIALLY_RECEIVED'))) THEN
  RAISE EXCEPTION 'Одиниця й спосіб обліку товару з рухами незмінні. Створіть окремий артикул для іншої фасовки.';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ledger_product_unit_guard BEFORE UPDATE ON inventory_parts FOR EACH ROW EXECUTE FUNCTION ledger_product_unit_guard();
CREATE FUNCTION ledger_unit_precision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.code,NEW.precision) IS DISTINCT FROM ROW(OLD.code,OLD.precision)
 AND EXISTS(SELECT 1 FROM inventory_parts p JOIN stock_lots l ON l."inventoryPartId"=p.id WHERE p."unitId"=OLD.id) THEN
  RAISE EXCEPTION 'Одиниця з історичними рухами незмінна';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ledger_unit_precision_guard BEFORE UPDATE ON units_of_measure FOR EACH ROW EXECUTE FUNCTION ledger_unit_precision_guard();

CREATE OR REPLACE FUNCTION ledger_has_unfulfilled_parts(record_id text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(
  SELECT 1 FROM service_parts p LEFT JOIN stock_demands d ON d."servicePartId"=p.id AND d.state='ACTIVE'
  LEFT JOIN inventory_parts ip ON ip.id=p."inventoryPartId"
  WHERE p."serviceRecordId"=record_id AND p.quantity>0 AND (
   (p."stockOwnership"='CUSTOMER' AND NOT p."customerPartInstalled") OR
   (p."stockOwnership"='OWN' AND COALESCE(ip."trackingMode",'STOCK')='STOCK' AND (p."inventoryPartId" IS NULL OR d.id IS NULL OR p.quantity>COALESCE((SELECT sum(CASE WHEN doc.kind='ISSUE' THEN a.quantity ELSE -a.quantity END) FROM document_lot_allocations a JOIN inventory_document_lines l ON l.id=a."documentLineId" JOIN inventory_documents doc ON doc.id=l."documentId" WHERE a."demandId"=d.id),0)))
  )
 );
$$;
