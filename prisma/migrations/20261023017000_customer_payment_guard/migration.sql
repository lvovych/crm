-- Every writer, including imports and integrations, must use the mode adapter.
-- Legacy rows stay intact; migrated jobs never turn old payments into new cash.
CREATE FUNCTION ledger_legacy_payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent text;
BEGIN
 parent := CASE WHEN TG_OP='DELETE' THEN OLD."serviceRecordId" ELSE NEW."serviceRecordId" END;
 IF EXISTS(SELECT 1 FROM service_records WHERE id=parent AND "financeAccountingMode"='LEDGER')
 OR (TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM service_records WHERE id=OLD."serviceRecordId" AND "financeAccountingMode"='LEDGER')) THEN
  RAISE EXCEPTION 'Для нового фінансового обліку використовуйте платіжний реєстр і документи сторно';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER ledger_legacy_payment_guard BEFORE INSERT OR UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION ledger_legacy_payment_guard();
