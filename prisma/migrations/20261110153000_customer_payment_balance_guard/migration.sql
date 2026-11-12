-- Deferred until commit: corrections may reverse and replace a payment within one transaction.
-- The parent-document row lock in customer_ledger_payment serializes concurrent writers.
CREATE FUNCTION customer_ledger_nonnegative_payments() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (
  SELECT 1 FROM (
   SELECT sum(sum("paidDelta")) OVER (ORDER BY "effectiveDate") AS balance
   FROM customer_ledger_events WHERE "documentId"=NEW."documentId"
   GROUP BY "effectiveDate"
  ) days WHERE balance<0
 ) THEN
  RAISE EXCEPTION 'Повернення або скасування перевищує суму оплат наряду на відповідну дату';
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER customer_ledger_payment_balance
AFTER INSERT ON customer_ledger_events DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION customer_ledger_nonnegative_payments();
