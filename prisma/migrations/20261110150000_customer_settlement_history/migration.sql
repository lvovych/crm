ALTER TABLE service_records ADD COLUMN "customerLedgerTracked" boolean NOT NULL DEFAULT false,
 ADD COLUMN "ledgerActorId" text, ADD COLUMN "ledgerActorName" text;
ALTER TABLE payments ADD COLUMN "ledgerActorId" text, ADD COLUMN "ledgerActorName" text;
CREATE TABLE customer_ledger_documents (
 id text PRIMARY KEY, "organizationId" text NOT NULL, "customerId" text, "customerName" text,
 "vehicleId" text, label text NOT NULL, "createdAt" timestamptz(3) NOT NULL DEFAULT now(),
 UNIQUE("organizationId",id)
);
CREATE INDEX customer_ledger_documents_party ON customer_ledger_documents("organizationId","customerId");
CREATE TABLE customer_ledger_events (
 id bigserial PRIMARY KEY, "organizationId" text NOT NULL, "documentId" text NOT NULL,
 kind text NOT NULL, "effectiveDate" date NOT NULL, "recordedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 "chargeDelta" decimal(22,2) NOT NULL DEFAULT 0, "paidDelta" decimal(22,2) NOT NULL DEFAULT 0,
 amount decimal(22,2), status text, due date, "manualPaid" boolean,
 "paymentId" text, "sourceDate" date, "actorId" text, "actorName" text, note text,
 FOREIGN KEY("organizationId","documentId") REFERENCES customer_ledger_documents("organizationId",id) ON DELETE RESTRICT
);
CREATE INDEX customer_ledger_events_asof ON customer_ledger_events("organizationId","effectiveDate","documentId");
CREATE INDEX customer_ledger_events_doc ON customer_ledger_events("documentId",id);
CREATE FUNCTION customer_ledger_zone(org text) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE zone text;
BEGIN
 SELECT value INTO zone FROM app_settings WHERE "organizationId"=org
 AND key IN ('workshop.timezone','workshop.timezoneDetected') AND trim(value)<>''
 ORDER BY CASE key WHEN 'workshop.timezone' THEN 0 ELSE 1 END LIMIT 1;
 IF zone IS NULL OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=zone) THEN RETURN 'UTC'; END IF;
 RETURN zone;
END $$;
CREATE FUNCTION customer_ledger_money(value double precision) RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
 IF value::text IN ('NaN','Infinity','-Infinity') OR abs(value)>90071992547409.91 THEN
  RAISE EXCEPTION 'Некоректна сума для взаєморозрахунків';
 END IF;
 RETURN round(value::text::numeric,2);
END $$;
CREATE FUNCTION customer_ledger_record() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org text; cid text; cname text; zone text; day date; oldcharge numeric:=0; newcharge numeric:=0; total numeric; eventkind text;
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
 IF TG_OP='UPDATE' AND NEW."customerLedgerTracked" IS DISTINCT FROM OLD."customerLedgerTracked" THEN
  RAISE EXCEPTION 'Не можна змінювати область історичного обліку наряду';
 END IF;
 IF NOT NEW."customerLedgerTracked" THEN RETURN NEW; END IF;
 org:=NEW."organizationId";
 IF org IS NULL THEN RAISE EXCEPTION 'Організація наряду не визначена'; END IF;
 IF TG_OP='UPDATE' AND org IS DISTINCT FROM OLD."organizationId" THEN RAISE EXCEPTION 'Не можна переносити фінансовий документ між організаціями'; END IF;
 zone:=customer_ledger_zone(org); day:=(clock_timestamp() AT TIME ZONE zone)::date;
 SELECT c.id,c.name INTO cid,cname FROM customers c WHERE c."organizationId"=org AND c.id=COALESCE(NEW."customerId",(SELECT "customerId" FROM vehicles WHERE id=NEW."vehicleId" AND "organizationId"=org));
 IF TG_OP='INSERT' THEN
  INSERT INTO customer_ledger_documents(id,"organizationId","customerId","customerName","vehicleId",label)
  VALUES(NEW.id,org,cid,cname,NEW."vehicleId",COALESCE(NEW."invoiceNumber",NEW.title));
  eventkind:='created';
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
 RETURN NEW;
END $$;
CREATE TRIGGER customer_ledger_record_write AFTER INSERT OR UPDATE ON service_records FOR EACH ROW EXECUTE FUNCTION customer_ledger_record();
CREATE TRIGGER customer_ledger_record_delete BEFORE DELETE ON service_records FOR EACH ROW EXECUTE FUNCTION customer_ledger_record();
CREATE FUNCTION customer_ledger_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE doc text; org text; zone text; today date; amount numeric; actor text; actorname text;
BEGIN
 doc:=CASE WHEN TG_OP='DELETE' THEN OLD."serviceRecordId" ELSE NEW."serviceRecordId" END;
 IF TG_OP='UPDATE' AND NEW."serviceRecordId"<>OLD."serviceRecordId" AND (EXISTS(SELECT 1 FROM customer_ledger_documents WHERE id IN (NEW."serviceRecordId",OLD."serviceRecordId"))) THEN
  RAISE EXCEPTION 'Не можна переносити оплату між нарядами з історією';
 END IF;
 SELECT "organizationId" INTO org FROM customer_ledger_documents WHERE id=doc FOR UPDATE;
 IF org IS NULL THEN RETURN COALESCE(NEW,OLD); END IF;
 zone:=customer_ledger_zone(org);today:=(clock_timestamp() AT TIME ZONE zone)::date;
 IF TG_OP='UPDATE' AND (NEW.amount,NEW."amountExact",NEW.date,NEW.method,NEW.note) IS NOT DISTINCT FROM (OLD.amount,OLD."amountExact",OLD.date,OLD.method,OLD.note) THEN RETURN NEW; END IF;
 actor:=CASE WHEN TG_OP='DELETE' THEN OLD."ledgerActorId" ELSE NEW."ledgerActorId" END;
 actorname:=CASE WHEN TG_OP='DELETE' THEN OLD."ledgerActorName" ELSE NEW."ledgerActorName" END;
 IF TG_OP IN ('UPDATE','DELETE') THEN
  amount:=COALESCE(OLD."amountExact",customer_ledger_money(OLD.amount));
  INSERT INTO customer_ledger_events("organizationId","documentId",kind,"effectiveDate","paidDelta","paymentId","sourceDate","actorId","actorName",note)
  VALUES(org,doc,'payment_reversed',GREATEST(today,(OLD.date AT TIME ZONE 'UTC' AT TIME ZONE zone)::date),-amount,OLD.id,(OLD.date AT TIME ZONE 'UTC' AT TIME ZONE zone)::date,actor,actorname,'Скасування попереднього запису оплати');
 END IF;
 IF TG_OP IN ('INSERT','UPDATE') THEN
  amount:=COALESCE(NEW."amountExact",customer_ledger_money(NEW.amount));
  IF amount::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Некоректна сума оплати'; END IF;
  INSERT INTO customer_ledger_events("organizationId","documentId",kind,"effectiveDate","paidDelta","paymentId","sourceDate","actorId","actorName",note)
  VALUES(org,doc,CASE WHEN amount<0 THEN 'refund' ELSE 'payment' END,GREATEST(today,(NEW.date AT TIME ZONE 'UTC' AT TIME ZONE zone)::date),amount,NEW.id,(NEW.date AT TIME ZONE 'UTC' AT TIME ZONE zone)::date,actor,actorname,NEW.note);
 END IF;
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER customer_ledger_payment_write AFTER INSERT OR UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION customer_ledger_payment();
CREATE FUNCTION customer_ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Історію взаєморозрахунків не можна змінити або видалити'; END $$;
CREATE TRIGGER customer_ledger_event_immutable BEFORE UPDATE OR DELETE ON customer_ledger_events FOR EACH ROW EXECUTE FUNCTION customer_ledger_immutable();
