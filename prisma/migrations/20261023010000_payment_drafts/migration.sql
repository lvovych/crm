ALTER TABLE money_transactions DROP CONSTRAINT payment_valid;
ALTER TABLE money_transactions ADD CONSTRAINT payment_valid CHECK(amount>0 AND currency='UAH' AND direction IN ('IN','OUT') AND status IN ('DRAFT','CANCELLED','POSTED','REVERSED'));
CREATE OR REPLACE FUNCTION money_transaction_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.status='DRAFT' AND NEW.status IN ('DRAFT','CANCELLED','POSTED') AND NEW.version=OLD.version+1
  AND NEW.id=OLD.id AND NEW."organizationId"=OLD."organizationId" AND NEW."createdAt"=OLD."createdAt" AND NEW."createdById" IS NOT DISTINCT FROM OLD."createdById" AND NEW."reversalOfId" IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.status='POSTED' AND NEW.status='REVERSED'
  AND OLD."reversalOfId" IS NULL AND NEW.version=OLD.version+1
  AND (to_jsonb(OLD)-'status'-'version')=(to_jsonb(NEW)-'status'-'version')
  AND EXISTS(SELECT 1 FROM money_transactions r WHERE r."organizationId"=OLD."organizationId" AND r."reversalOfId"=OLD.id)
 THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Posted or cancelled payments are immutable';
END $$;
CREATE FUNCTION ledger_payment_source_posted() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."moneyTransactionId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM money_transactions WHERE id=NEW."moneyTransactionId" AND "organizationId"=NEW."organizationId" AND status='POSTED') THEN RAISE EXCEPTION 'Payment source must be posted'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER cash_payment_posted BEFORE INSERT ON cash_ledger_entries FOR EACH ROW EXECUTE FUNCTION ledger_payment_source_posted();
CREATE TRIGGER settlement_payment_posted BEFORE INSERT ON settlement_entries FOR EACH ROW EXECUTE FUNCTION ledger_payment_source_posted();
