#!/usr/bin/env python3
"""Generate one atomic SQL import from the reviewed order payload; does not execute it."""
import hashlib,json,os
from pathlib import Path
os.umask(0o077)
p=Path(__file__).resolve().parents[1]/'.secrets/carbook'
x=json.loads((p/'orders-import-payload.json').read_text());summary=json.loads((p/'orders-import-summary.json').read_text())
org=x['records'][0]['organizationId']
def q(v):return "'"+str(v).replace("'","''")+"'"
batch='cb_orders_'+hashlib.sha256((org+summary['sourceSha256']+summary['paymentPolicy']).encode()).hexdigest()[:32]
sql=['\\set ON_ERROR_STOP on','BEGIN;',"SET LOCAL standard_conforming_strings=on;","SET LOCAL lock_timeout='15s';",
 'LOCK TABLE service_records, payments, customers IN SHARE ROW EXCLUSIVE MODE;',
 f'''CREATE TEMP TABLE import_ctx AS SELECT u.id AS uid, m."organizationId" AS oid
 FROM users u JOIN organization_members m ON m."userId"=u.id
 WHERE u.email='ceo@lauto.com.ua' AND m."organizationId"={q(org)} AND m.role='owner';
 DO $$ BEGIN IF (SELECT count(*) FROM import_ctx)<>1 THEN RAISE EXCEPTION 'Owner context mismatch'; END IF; END $$;''']
schemas={
 'records':{'id':'text','title':'text','invoiceNumber':'text','description':'text','type':'text','status':'text','vehicleId':'text','customerId':'text','organizationId':'text','cost':'double precision','totalAmount':'double precision','subtotal':'double precision','taxAmount':'double precision','taxRate':'double precision','taxInclusive':'boolean','discountType':'text','discountValue':'double precision','discountAmount':'double precision','manuallyPaid':'boolean','serviceDate':'timestamp','startDateTime':'timestamp','endDateTime':'timestamp','promisedAt':'timestamp','invoiceDate':'timestamp','mileage':'integer','createdAt':'timestamp','updatedAt':'timestamp','techName':'text','expectedPaid':'numeric','expectedDebt':'numeric'},
 'parts':{'id':'text','serviceRecordId':'text','name':'text','partNumber':'text','quantity':'double precision','unit':'text','unitPrice':'double precision','total':'double precision','unitCost':'double precision','markupPercent':'double precision'},
 'labors':{'id':'text','serviceRecordId':'text','description':'text','hours':'double precision','rate':'double precision','total':'double precision','pricingType':'text'},
 'payments':{'id':'text','serviceRecordId':'text','amount':'double precision','date':'timestamp','method':'text','provider':'text','externalId':'text','note':'text','createdAt':'timestamp','updatedAt':'timestamp'},
 'restoredCustomers':{'id':'text','name':'text','phone':'text','email':'text','company':'text','notes':'text','reminderOptOut':'boolean'}}
for name,schema in schemas.items():
 columns=','.join('"'+k+'" '+v for k,v in schema.items())
 sql.append(f'CREATE TEMP TABLE st_{name} AS SELECT * FROM jsonb_to_recordset({q(json.dumps(x[name],ensure_ascii=False))}::jsonb) AS r({columns});')
sql.append(f'''
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM service_records s JOIN st_records r ON s."invoiceNumber"=r."invoiceNumber"
 WHERE s."organizationId"={q(org)} AND s.id<>r.id) THEN RAISE EXCEPTION 'Invoice number collision'; END IF;
 IF EXISTS(SELECT 1 FROM service_records s JOIN st_records r ON s.id=r.id WHERE s."organizationId" IS DISTINCT FROM {q(org)})
 THEN RAISE EXCEPTION 'Foreign order identity'; END IF;
 IF EXISTS(SELECT 1 FROM st_records r LEFT JOIN vehicles v ON v.id=r."vehicleId" AND v."organizationId"={q(org)}
 WHERE r."vehicleId" IS NOT NULL AND v.id IS NULL) THEN RAISE EXCEPTION 'Missing vehicle'; END IF;
END $$;
INSERT INTO customers (id,name,phone,email,company,notes,"reminderOptOut","userId","organizationId","createdAt","updatedAt")
SELECT r.id,r.name,r.phone,r.email,r.company,r.notes,r."reminderOptOut",c.uid,c.oid,now(),now()
FROM st_restoredCustomers r CROSS JOIN import_ctx c WHERE NOT EXISTS(SELECT 1 FROM customers WHERE id=r.id);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM st_records r LEFT JOIN customers c ON c.id=r."customerId" AND c."organizationId"={q(org)}
 WHERE r."customerId" IS NOT NULL AND c.id IS NULL) THEN RAISE EXCEPTION 'Missing historical customer'; END IF;
END $$;
INSERT INTO import_batches (id,"organizationId","userId",source,entity,"fileName",status,"totalRows",created,updated,skipped,failed,mapping,"createdAt")
SELECT {q(batch)},oid,uid,'carbook','services','orders-with-details.json','completed',{len(x['records'])},0,0,0,0,
 {q(json.dumps(summary))}::jsonb,now() FROM import_ctx ON CONFLICT(id) DO NOTHING;
''')
for name,table in [('records','service_records'),('parts','service_parts'),('labors','service_labor'),('payments','payments')]:
 cols=[k for k in schemas[name] if not k.startswith('expected')]
 quoted=','.join('"'+c+'"' for c in cols)
 extra=',"importBatchId"' if name=='records' else ''
 extra_value=','+q(batch) if name=='records' else ''
 sql.append(f'INSERT INTO {table} ({quoted}{extra}) SELECT {quoted}{extra_value} FROM st_{name} i WHERE NOT EXISTS(SELECT 1 FROM {table} t WHERE t.id=i.id);')
sql.append(f'''
DO $$ BEGIN
 IF (SELECT count(*) FROM service_records s JOIN st_records r ON r.id=s.id
 WHERE s."invoiceNumber"=r."invoiceNumber" AND s.title=r.title AND s.status=r.status
 AND s."organizationId"={q(org)} AND s."vehicleId" IS NOT DISTINCT FROM r."vehicleId"
 AND s."customerId" IS NOT DISTINCT FROM r."customerId" AND s."serviceDate"=r."serviceDate"
 AND abs(s."totalAmount"::numeric-r."totalAmount"::numeric)<0.005) <> {len(x['records'])}
 THEN RAISE EXCEPTION 'Record fields or relationships mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM st_records r JOIN service_records s ON s.id=r.id
 LEFT JOIN LATERAL(SELECT coalesce(sum(amount::numeric),0) AS paid FROM payments WHERE "serviceRecordId"=r.id) p ON true
 WHERE abs(p.paid-r."expectedPaid")>0.005 OR abs(s."totalAmount"::numeric-p.paid-r."expectedDebt")>0.005)
 THEN RAISE EXCEPTION 'Paid amount or balance mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM st_records r JOIN service_records s ON s.id=r.id
 LEFT JOIN LATERAL(SELECT coalesce(sum(total::numeric),0) AS total FROM service_parts WHERE "serviceRecordId"=r.id) p ON true
 LEFT JOIN LATERAL(SELECT coalesce(sum(total::numeric),0) AS total FROM service_labor WHERE "serviceRecordId"=r.id) l ON true
 WHERE abs(p.total+l.total-s."discountAmount"::numeric+s."taxAmount"::numeric-s."totalAmount"::numeric)>0.005)
 THEN RAISE EXCEPTION 'Line items do not reconcile to document total'; END IF;
END $$;
''')
for name,table in [('parts','service_parts'),('labors','service_labor'),('payments','payments')]:
 sql.append(f'''DO $$ BEGIN IF (SELECT count(*) FROM {table} t JOIN st_{name} i ON i.id=t.id
 WHERE t."serviceRecordId"=i."serviceRecordId" AND abs(t.{('amount' if name=='payments' else 'total')}::numeric-i.{('amount' if name=='payments' else 'total')}::numeric)<0.005)<>{len(x[name])}
 THEN RAISE EXCEPTION '{name} mismatch'; END IF; END $$;''')
sql.append(f'''
UPDATE import_batches SET created=(SELECT count(*) FROM service_records WHERE "importBatchId"={q(batch)}),
 skipped={len(x['records'])}-(SELECT count(*) FROM service_records WHERE "importBatchId"={q(batch)}) WHERE id={q(batch)};
INSERT INTO audit_logs(id,action,entity,"entityId",message,"userId","organizationId",metadata)
SELECT {q(batch)},'import.commit','ImportBatch',{q(batch)},'Carbook orders, line items, historical customer links and payments imported',uid,oid,
 {q(json.dumps(summary))}::jsonb FROM import_ctx ON CONFLICT(id) DO NOTHING;
COMMIT;
SELECT json_build_object('orders',count(*),'total',sum(s."totalAmount"::numeric),'paid',sum(p.paid),'netDebt',sum(s."totalAmount"::numeric-p.paid))
FROM service_records s JOIN st_records r ON r.id=s.id
LEFT JOIN LATERAL(SELECT coalesce(sum(amount::numeric),0) AS paid FROM payments WHERE "serviceRecordId"=s.id) p ON true;
''')
(p/'orders-import.sql').write_text('\n'.join(sql))
print(json.dumps({'prepared':True,'batchId':batch,'records':len(x['records']),'paymentPolicy':summary['paymentPolicy']}))
