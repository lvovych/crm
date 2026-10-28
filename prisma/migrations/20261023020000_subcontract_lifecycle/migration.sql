ALTER TABLE supplier_service_documents ADD COLUMN "reversalOfId" TEXT, ADD COLUMN reason TEXT;
ALTER TABLE supplier_service_documents ADD CONSTRAINT subcontract_reversal_fk FOREIGN KEY ("organizationId","reversalOfId") REFERENCES supplier_service_documents("organizationId",id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX subcontract_single_reversal ON supplier_service_documents("organizationId","reversalOfId") WHERE "reversalOfId" IS NOT NULL;
ALTER TABLE supplier_service_documents ADD CONSTRAINT subcontract_status CHECK(status IN ('DRAFT','POSTED','CANCELLED'));
ALTER TABLE supplier_service_documents ADD CONSTRAINT subcontract_reversal_reason CHECK("reversalOfId" IS NULL OR (status='POSTED' AND length(trim(reason))>=5));
DROP TRIGGER subcontract_immutable ON supplier_service_documents;
CREATE TRIGGER subcontract_immutable BEFORE UPDATE OR DELETE ON supplier_service_documents FOR EACH ROW WHEN (OLD.status <> 'DRAFT') EXECUTE FUNCTION ledger_immutable();
ALTER TABLE supplier_service_lines ADD COLUMN "taxMode" TEXT NOT NULL DEFAULT 'NONE', ADD COLUMN "taxRate" numeric(7,3) NOT NULL DEFAULT 0, ADD COLUMN "netAmount" numeric(20,2) NOT NULL DEFAULT 0, ADD COLUMN "taxAmount" numeric(20,2) NOT NULL DEFAULT 0;
DROP TRIGGER subcontract_line_immutable ON supplier_service_lines;
UPDATE supplier_service_lines SET "netAmount"="totalAmount";
ALTER TABLE supplier_service_lines ADD CONSTRAINT subcontract_line_tax CHECK("taxMode" IN ('NONE','INCLUSIVE','EXCLUSIVE') AND "taxRate" BETWEEN 0 AND 100 AND "netAmount">=0 AND "taxAmount">=0 AND "totalAmount"="netAmount"+"taxAmount" AND ("taxMode"<>'NONE' OR ("taxRate"=0 AND "taxAmount"=0)));
CREATE FUNCTION subcontract_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP <> 'INSERT' AND EXISTS (SELECT 1 FROM supplier_service_documents WHERE id=OLD."documentId" AND status<>'DRAFT') THEN RAISE EXCEPTION 'Posted subcontract lines are immutable'; END IF;
 IF TG_OP <> 'DELETE' AND EXISTS (SELECT 1 FROM supplier_service_documents WHERE id=NEW."documentId" AND status='CANCELLED') THEN RAISE EXCEPTION 'Cancelled subcontract cannot gain lines'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER subcontract_line_immutable BEFORE INSERT OR UPDATE OR DELETE ON supplier_service_lines FOR EACH ROW EXECUTE FUNCTION subcontract_line_guard();
CREATE FUNCTION subcontract_totals_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE doc supplier_service_documents%ROWTYPE; target text;
BEGIN
 target:=CASE WHEN TG_TABLE_NAME='supplier_service_documents' THEN NEW.id ELSE NEW."documentId" END;
 SELECT * INTO doc FROM supplier_service_documents WHERE id=target;
 IF doc.status='POSTED' AND (doc."totalAmount"<>(SELECT COALESCE(SUM("totalAmount"),0) FROM supplier_service_lines WHERE "documentId"=target) OR doc."totalAmount"<>(SELECT COALESCE(SUM(amount),0) FROM settlement_entries WHERE "supplierServiceDocumentId"=target)) THEN RAISE EXCEPTION 'Posted subcontract totals do not match its lines and AP entry'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER subcontract_totals AFTER INSERT OR UPDATE ON supplier_service_documents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION subcontract_totals_guard();
CREATE CONSTRAINT TRIGGER subcontract_line_totals AFTER INSERT OR UPDATE ON supplier_service_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION subcontract_totals_guard();
