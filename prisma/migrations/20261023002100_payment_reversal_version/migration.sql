CREATE OR REPLACE FUNCTION money_transaction_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.status='POSTED' AND NEW.status='REVERSED'
  AND OLD."reversalOfId" IS NULL AND NEW.version=OLD.version+1
  AND (to_jsonb(OLD)-'status'-'version')=(to_jsonb(NEW)-'status'-'version')
  AND EXISTS(SELECT 1 FROM money_transactions r WHERE r."organizationId"=OLD."organizationId" AND r."reversalOfId"=OLD.id)
 THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Posted payments are immutable';
END $$;
