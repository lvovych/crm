-- The editor updates the header before lines. Acquire the organization lock
-- here, but validate completion at transaction end after installation flags
-- and part lines have been saved. The deferred header/part guards remain active.
CREATE OR REPLACE FUNCTION ledger_completion_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."inventoryAccountingMode"='LEDGER' AND NEW.status='completed' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."organizationId",613));
 END IF;
 RETURN NEW;
END $$;
