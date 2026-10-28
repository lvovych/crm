CREATE TABLE ledger_migration_batches (
 id TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,"createdById" TEXT REFERENCES users(id) ON DELETE SET NULL,"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "effectiveAt" date NOT NULL,checksum TEXT NOT NULL,"sourceChecksum" TEXT NOT NULL,manifest jsonb NOT NULL,mapping jsonb NOT NULL,
 UNIQUE("organizationId",checksum),UNIQUE("organizationId",id),CHECK(checksum ~ '^[a-f0-9]{64}$' AND "sourceChecksum" ~ '^[a-f0-9]{64}$')
);
CREATE TRIGGER ledger_migration_immutable BEFORE UPDATE OR DELETE ON ledger_migration_batches FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
CREATE OR REPLACE FUNCTION stock_cutover_setting_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.key IN ('stockLedger.approvedCutover.v1','stockLedger.approvedFinanceCutover.v1') THEN RAISE EXCEPTION 'Ledger cutover approval is immutable; use the recovery runbook'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION ledger_has_unfulfilled_parts(record_id text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(
  SELECT 1 FROM service_parts p LEFT JOIN stock_demands d ON d."servicePartId"=p.id AND d.state='ACTIVE'
  LEFT JOIN inventory_parts ip ON ip.id=p."inventoryPartId"
  WHERE p."serviceRecordId"=record_id AND p.quantity>0 AND (
   (p."stockOwnership"='CUSTOMER' AND NOT p."customerPartInstalled") OR
   (p."stockOwnership"='OWN' AND COALESCE(ip."trackingMode",'STOCK')='STOCK' AND (p."inventoryPartId" IS NULL OR d.id IS NULL OR p.quantity>COALESCE((SELECT sum(CASE WHEN doc.kind IN ('ISSUE','MIGRATION_ISSUE') THEN a.quantity ELSE -a.quantity END) FROM document_lot_allocations a JOIN inventory_document_lines l ON l.id=a."documentLineId" JOIN inventory_documents doc ON doc.id=l."documentId" WHERE a."demandId"=d.id),0)))
  )
 );
$$;
