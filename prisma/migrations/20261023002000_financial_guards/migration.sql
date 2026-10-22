CREATE FUNCTION money_transaction_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.status='POSTED' AND NEW.status='REVERSED'
  AND OLD."reversalOfId" IS NULL
  AND (to_jsonb(OLD)-'status')=(to_jsonb(NEW)-'status')
  AND EXISTS(SELECT 1 FROM money_transactions r WHERE r."organizationId"=OLD."organizationId" AND r."reversalOfId"=OLD.id)
 THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Posted payments are immutable';
END $$;
CREATE TRIGGER money_transaction_immutable BEFORE UPDATE OR DELETE ON money_transactions FOR EACH ROW EXECUTE FUNCTION money_transaction_guard();

CREATE FUNCTION allocation_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE debit settlement_entries; credit settlement_entries; used_debit numeric; used_credit numeric;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW."organizationId",613));
 SELECT * INTO STRICT debit FROM settlement_entries WHERE id=NEW."debitEntryId" AND "organizationId"=NEW."organizationId" FOR UPDATE;
 SELECT * INTO STRICT credit FROM settlement_entries WHERE id=NEW."creditEntryId" AND "organizationId"=NEW."organizationId" FOR UPDATE;
 IF debit.polarity<>'DEBIT' OR credit.polarity<>'CREDIT' OR debit."partyId"<>credit."partyId" OR debit.side<>credit.side OR debit.currency<>credit.currency THEN RAISE EXCEPTION 'Settlement allocation sources do not match'; END IF;
 IF NEW."effectiveAt"<debit."effectiveAt" OR NEW."effectiveAt"<credit."effectiveAt" THEN RAISE EXCEPTION 'Allocation cannot precede its sources'; END IF;
 SELECT COALESCE(sum(amount),0) INTO used_debit FROM settlement_allocations WHERE "organizationId"=NEW."organizationId" AND "debitEntryId"=debit.id AND "reversedAt" IS NULL;
 SELECT COALESCE(sum(amount),0) INTO used_credit FROM settlement_allocations WHERE "organizationId"=NEW."organizationId" AND "creditEntryId"=credit.id AND "reversedAt" IS NULL;
 IF used_debit+NEW.amount>debit.amount OR used_credit+NEW.amount>credit.amount THEN RAISE EXCEPTION 'Allocation exceeds outstanding balance'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER allocation_source_check BEFORE INSERT ON settlement_allocations FOR EACH ROW EXECUTE FUNCTION allocation_source_guard();
