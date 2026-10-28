CREATE FUNCTION ledger_legacy_quantity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM app_settings WHERE "organizationId"=NEW."organizationId" AND key='stockLedger.approvedCutover.v1') THEN
  IF TG_OP='INSERT' THEN
   IF NEW.quantity<>0 THEN RAISE EXCEPTION 'Початкову кількість після переходу додають складським документом'; END IF;
  ELSIF NEW.quantity IS DISTINCT FROM OLD.quantity THEN RAISE EXCEPTION 'Кількість змінюється лише складськими документами'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ledger_legacy_quantity_guard BEFORE INSERT OR UPDATE OF quantity ON inventory_parts FOR EACH ROW EXECUTE FUNCTION ledger_legacy_quantity_guard();
