-- A production cutover is not a reversible display preference. Clearing this
-- key would re-enable legacy writers after opening balances were accepted.
CREATE FUNCTION stock_cutover_setting_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.key='stockLedger.approvedCutover.v1' THEN RAISE EXCEPTION 'Stock cutover approval is immutable; use the recovery runbook'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER stock_cutover_immutable BEFORE UPDATE OR DELETE ON app_settings FOR EACH ROW EXECUTE FUNCTION stock_cutover_setting_guard();
