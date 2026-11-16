BEGIN;
CREATE FUNCTION customer_ledger_track_completion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW."customerLedgerTracked" := true;
 RETURN NEW;
END $$;

CREATE TRIGGER customer_ledger_track_completion BEFORE UPDATE OF status ON service_records
FOR EACH ROW WHEN (NOT OLD."customerLedgerTracked" AND OLD.status IS DISTINCT FROM NEW.status AND NEW.status='completed')
EXECUTE FUNCTION customer_ledger_track_completion();

-- Serialize legacy payment mutations with the transition that snapshots those payments.
CREATE FUNCTION customer_ledger_lock_payment_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM id FROM service_records
 WHERE id IN (CASE WHEN TG_OP<>'INSERT' THEN OLD."serviceRecordId" END,
              CASE WHEN TG_OP<>'DELETE' THEN NEW."serviceRecordId" END)
 ORDER BY id FOR NO KEY UPDATE;
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER customer_ledger_lock_payment_order BEFORE INSERT OR UPDATE OR DELETE ON payments
FOR EACH ROW EXECUTE FUNCTION customer_ledger_lock_payment_order();

CREATE OR REPLACE FUNCTION customer_ledger_record() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org text; cid text; cname text; zone text; day date; oldcharge numeric:=0; newcharge numeric:=0; total numeric; eventkind text; adopting boolean := false;
BEGIN
 IF TG_OP='DELETE' THEN
  IF NOT OLD."customerLedgerTracked" THEN RETURN OLD; END IF;
  PERFORM 1 FROM customer_ledger_documents WHERE id=OLD.id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM customer_ledger_events WHERE "documentId"=OLD.id AND ("chargeDelta"<>0 OR "paidDelta"<>0)) THEN
   RAISE EXCEPTION 'Наряд має історію розрахунків. Скасуйте його замість видалення.';
  END IF;
  INSERT INTO customer_ledger_events("organizationId","documentId",kind,"effectiveDate",amount,status,note)
  VALUES(OLD."organizationId",OLD.id,'deleted',(clock_timestamp() AT TIME ZONE customer_ledger_zone(OLD."organizationId"))::date,0,'deleted','Видалено наряд без фінансових операцій');
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN
  adopting := NOT OLD."customerLedgerTracked" AND NEW."customerLedgerTracked" AND NEW.status='completed';
 END IF;
 IF TG_OP='UPDATE' AND NOT adopting AND NEW."customerLedgerTracked" IS DISTINCT FROM OLD."customerLedgerTracked" THEN
  RAISE EXCEPTION 'Не можна змінювати область історичного обліку наряду';
 END IF;
 IF NOT NEW."customerLedgerTracked" THEN RETURN NEW; END IF;
 org:=NEW."organizationId";
 IF org IS NULL THEN RAISE EXCEPTION 'Організація наряду не визначена'; END IF;
 IF TG_OP='UPDATE' AND org IS DISTINCT FROM OLD."organizationId" THEN RAISE EXCEPTION 'Не можна переносити фінансовий документ між організаціями'; END IF;
 zone:=customer_ledger_zone(org); day:=(clock_timestamp() AT TIME ZONE zone)::date;
 SELECT c.id,c.name INTO cid,cname FROM customers c WHERE c."organizationId"=org AND c.id=COALESCE(NEW."customerId",(SELECT "customerId" FROM vehicles WHERE id=NEW."vehicleId" AND "organizationId"=org));
 IF TG_OP='INSERT' OR adopting THEN
  INSERT INTO customer_ledger_documents(id,"organizationId","customerId","customerName","vehicleId",label)
  VALUES(NEW.id,org,cid,cname,NEW."vehicleId",COALESCE(NEW."invoiceNumber",NEW.title));
  eventkind:=CASE WHEN adopting THEN 'completed' ELSE 'created' END;
 ELSE
  PERFORM 1 FROM customer_ledger_documents WHERE id=NEW.id FOR UPDATE;
  -- Resolve an initially anonymous document once; never follow subsequent owner/contact changes.
  UPDATE customer_ledger_documents SET "customerId"=cid,"customerName"=cname WHERE id=NEW.id AND "customerId" IS NULL AND cid IS NOT NULL;
  IF (NEW.status,NEW."totalAmount",NEW."invoiceDueDate",NEW."manuallyPaid") IS NOT DISTINCT FROM (OLD.status,OLD."totalAmount",OLD."invoiceDueDate",OLD."manuallyPaid") THEN RETURN NEW; END IF;
  oldcharge:=CASE WHEN OLD.status='completed' THEN customer_ledger_money(OLD."totalAmount") ELSE 0 END;
  eventkind:=CASE WHEN NEW.status IN ('cancelled','canceled') THEN 'cancelled' WHEN NEW.status='completed' AND OLD.status<>'completed' THEN 'completed' WHEN NEW.status<>OLD.status THEN 'status_changed' ELSE 'adjusted' END;
 END IF;
 total:=customer_ledger_money(NEW."totalAmount");
 IF total<0 THEN RAISE EXCEPTION 'Сума наряду не може бути від’ємною'; END IF;
 newcharge:=CASE WHEN NEW.status='completed' THEN total ELSE 0 END;
 INSERT INTO customer_ledger_events("organizationId","documentId",kind,"effectiveDate","chargeDelta",amount,status,due,"manualPaid","actorId","actorName",note)
 VALUES(org,NEW.id,eventkind,day,newcharge-oldcharge,total,NEW.status,(NEW."invoiceDueDate" AT TIME ZONE 'UTC' AT TIME ZONE zone)::date,NEW."manuallyPaid",NEW."ledgerActorId",NEW."ledgerActorName",CASE WHEN eventkind='adjusted' THEN 'Зміна суми, строку або ручної позначки оплати в наряді' ELSE NULL END);
 IF adopting THEN
  INSERT INTO customer_ledger_events("organizationId","documentId",kind,"effectiveDate","paidDelta","paymentId","sourceDate",note)
  SELECT org,NEW.id,CASE WHEN p.amount<0 THEN 'refund' ELSE 'payment' END,
         GREATEST(day,(p.date AT TIME ZONE 'UTC' AT TIME ZONE zone)::date),
         COALESCE(p."amountExact",customer_ledger_money(p.amount)),p.id,
         (p.date AT TIME ZONE 'UTC' AT TIME ZONE zone)::date,p.note
  FROM payments p WHERE p."serviceRecordId"=NEW.id ORDER BY p.date,p.id;
 END IF;
 RETURN NEW;
END $$;
COMMIT;
