CREATE OR REPLACE FUNCTION subcontract_totals_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE doc supplier_service_documents%ROWTYPE; target text;
BEGIN
 IF TG_TABLE_NAME='supplier_service_documents' THEN target:=NEW.id; ELSE target:=NEW."documentId"; END IF;
 SELECT * INTO doc FROM supplier_service_documents WHERE id=target;
 IF doc.status='POSTED' AND (doc."totalAmount"<>(SELECT COALESCE(SUM("totalAmount"),0) FROM supplier_service_lines WHERE "documentId"=target) OR doc."totalAmount"<>(SELECT COALESCE(SUM(amount),0) FROM settlement_entries WHERE "supplierServiceDocumentId"=target)) THEN RAISE EXCEPTION 'Posted subcontract totals do not match its lines and AP entry'; END IF;
 RETURN NULL;
END $$;
