CREATE UNIQUE INDEX inventory_full_reversal_once ON inventory_documents("organizationId","sourceDocumentId") WHERE kind='REVERSAL' AND status='POSTED';
ALTER TABLE inventory_documents ADD CONSTRAINT reversal_source_required CHECK(kind<>'REVERSAL' OR ("sourceDocumentId" IS NOT NULL AND "sourceDocumentId"<>id));
CREATE OR REPLACE FUNCTION inventory_document_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status <> 'DRAFT' THEN
  IF TG_OP='UPDATE' AND OLD.status='POSTED' AND NEW.status='REVERSED'
    AND NEW.version=OLD.version+1
    AND (to_jsonb(OLD)-'status'-'version')=(to_jsonb(NEW)-'status'-'version')
    AND EXISTS(SELECT 1 FROM inventory_documents r WHERE r."organizationId"=OLD."organizationId" AND r."sourceDocumentId"=OLD.id AND r.kind='REVERSAL' AND r.status='POSTED')
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Posted documents are immutable';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
