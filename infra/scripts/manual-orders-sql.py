#!/usr/bin/env python3
"""Generate atomic, repeatable SQL for approved workshop acts."""
import json,hashlib,os
from pathlib import Path
os.umask(0o077)
p=Path(__file__).resolve().parents[1]/'.secrets/manual-orders'
x=json.loads((p/'payload.json').read_text());decisions=json.loads((p/'decisions.json').read_text())
org='2265bbef-78ea-4987-8c2d-221cf0f215ef';batch='manual_acts_'+hashlib.sha256(json.dumps(x,sort_keys=True).encode()).hexdigest()[:24]
def q(s):return "'"+str(s).replace("'","''")+"'"
def cols(keys):return ','.join('"'+k+'"' for k in keys)
sql=['BEGIN;',"SET LOCAL lock_timeout='15s';",'LOCK TABLE service_records,customers,vehicles IN SHARE ROW EXCLUSIVE MODE;',f'''CREATE TEMP TABLE ctx AS SELECT u.id uid,m."organizationId" oid FROM users u JOIN organization_members m ON m."userId"=u.id WHERE u.email='ceo@lauto.com.ua' AND m.role='owner' AND m."organizationId"={q(org)};
DO $$ BEGIN IF (SELECT count(*) FROM ctx)<>1 THEN RAISE EXCEPTION 'Owner mismatch'; END IF; END $$;''']
types={'mileage':'integer','year':'integer','position':'integer','manuallyPaid':'boolean','serviceDate':'timestamp','invoiceDate':'timestamp'}
num={'cost','subtotal','totalAmount','discountValue','discountAmount','quantity','unitPrice','total','hours','rate'}
keys={}
for name,rows in x.items():
 keys[name]=list(dict.fromkeys(k for row in rows for k in row))
 schema=','.join('"'+k+'" '+types.get(k,'double precision' if k in num else 'text') for k in keys[name])
 sql.append(f'CREATE TEMP TABLE st_{name} AS SELECT * FROM jsonb_to_recordset({q(json.dumps(rows,ensure_ascii=False))}::jsonb) AS t({schema});')
sql.append(f'''INSERT INTO customers(id,name,phone,"customerNumber","userId","organizationId","updatedAt")
SELECT s.id,s.name,s.phone,(coalesce((SELECT max("customerNumber"::bigint) FROM customers WHERE "organizationId"={q(org)} AND "customerNumber"~'^[0-9]+$'),1000)+row_number() OVER(ORDER BY s.id))::text,c.uid,c.oid,now() FROM st_customers s CROSS JOIN ctx c WHERE NOT EXISTS(SELECT 1 FROM customers WHERE id=s.id);
INSERT INTO vehicles({cols(keys['vehicles'])},"userId","organizationId","updatedAt","fuelType",transmission)
SELECT {','.join('s."'+k+'"' for k in keys['vehicles'])},c.uid,c.oid,now(),NULL,NULL FROM st_vehicles s CROSS JOIN ctx c WHERE NOT EXISTS(SELECT 1 FROM vehicles WHERE id=s.id);
DO $$ BEGIN
IF EXISTS(SELECT 1 FROM st_records r LEFT JOIN vehicles v ON v.id=r."vehicleId" AND v."organizationId"={q(org)} WHERE v.id IS NULL) THEN RAISE EXCEPTION 'Missing vehicle'; END IF;
IF EXISTS(SELECT 1 FROM st_records r LEFT JOIN customers c ON c.id=r."customerId" AND c."organizationId"={q(org)} WHERE r."customerId" IS NOT NULL AND c.id IS NULL) THEN RAISE EXCEPTION 'Missing customer'; END IF;
IF EXISTS(SELECT 1 FROM st_records r JOIN service_records s ON s."vehicleId"=r."vehicleId" AND s."serviceDate"::date=r."serviceDate"::date AND abs(s."totalAmount"-r."totalAmount")<0.005 WHERE s.id<>r.id) THEN RAISE EXCEPTION 'Possible duplicate'; END IF;
END $$;
CREATE TEMP TABLE numbering AS SELECT
replace(replace(coalesce((SELECT value FROM app_settings WHERE "organizationId"={q(org)} AND key='workshop.invoicePrefix'), '{{year}}-'),'{{year}}',to_char(now() AT TIME ZONE 'Europe/Kyiv','YYYY')),'{{month}}',to_char(now() AT TIME ZONE 'Europe/Kyiv','MM')) prefix,
greatest(1000,coalesce((SELECT substring("invoiceNumber" from '([0-9]+)$')::bigint FROM service_records WHERE "organizationId"={q(org)} ORDER BY "createdAt" DESC LIMIT 1),1000),coalesce((SELECT nullif(value,'')::bigint-1 FROM app_settings WHERE "organizationId"={q(org)} AND key='workshop.invoiceStartNumber'),1000)) base;
ALTER TABLE st_records ADD COLUMN "invoiceNumber" text;
UPDATE st_records r SET "invoiceNumber"=s."invoiceNumber" FROM service_records s WHERE s.id=r.id;
WITH pending AS (SELECT id,row_number() OVER(ORDER BY position) n FROM st_records WHERE "invoiceNumber" IS NULL)
UPDATE st_records r SET "invoiceNumber"=n.prefix||(n.base+p.n)::text FROM pending p CROSS JOIN numbering n WHERE r.id=p.id;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM st_records r JOIN service_records s ON r."invoiceNumber"=s."invoiceNumber" AND s."organizationId"={q(org)} WHERE s.id<>r.id) THEN RAISE EXCEPTION 'Number collision'; END IF; END $$;
INSERT INTO import_batches(id,"organizationId","userId",source,entity,"fileName",status,"totalRows",created,mapping)
SELECT {q(batch)},oid,uid,'manual-xlsx','services','workshop-acts.zip','completed',20,20,{q(json.dumps(decisions))}::jsonb FROM ctx ON CONFLICT(id) DO NOTHING;
''')
for name,table in [('records','service_records'),('parts','service_parts'),('labors','service_labor')]:
 ks=[k for k in keys[name] if k!='position']
 extra='';values=''
 if name=='records':
  ks+=['invoiceNumber'];extra=',"organizationId","importBatchId","createdAt","updatedAt"';values=f",{q(org)},{q(batch)},now()+position*interval '1 microsecond',now()"
 sql.append(f'INSERT INTO {table}({cols(ks)}{extra}) SELECT {cols(ks)}{values} FROM st_{name} r WHERE NOT EXISTS(SELECT 1 FROM {table} WHERE id=r.id);')
sql.append(f'''DO $$ BEGIN
IF (SELECT count(*) FROM service_records s JOIN st_records r ON r.id=s.id WHERE s."organizationId"={q(org)} AND s."vehicleId"=r."vehicleId" AND s."customerId" IS NOT DISTINCT FROM r."customerId" AND s."manuallyPaid" AND s.status='completed' AND s."serviceDate"=r."serviceDate" AND abs(s."totalAmount"-r."totalAmount")<0.005 AND s."invoiceNumber"=r."invoiceNumber" AND s."invoiceNumber" NOT LIKE '%MRD%')<>20 THEN RAISE EXCEPTION 'Record verification failed'; END IF;
IF EXISTS(SELECT 1 FROM st_records r JOIN service_records s ON s.id=r.id WHERE abs(coalesce((SELECT sum(total::numeric) FROM service_parts WHERE "serviceRecordId"=r.id),0)+coalesce((SELECT sum(total::numeric) FROM service_labor WHERE "serviceRecordId"=r.id),0)-s."discountAmount"::numeric-s."totalAmount"::numeric)>0.005) THEN RAISE EXCEPTION 'Line total mismatch'; END IF;
IF EXISTS(SELECT 1 FROM payments p JOIN st_records r ON r.id=p."serviceRecordId") THEN RAISE EXCEPTION 'Unexpected payment'; END IF;
END $$;''')
for name,table in [('parts','service_parts'),('labors','service_labor')]:
 sql.append(f'''DO $$ BEGIN IF (SELECT count(*) FROM {table} t JOIN st_{name} r ON t.id=r.id WHERE t."serviceRecordId"=r."serviceRecordId" AND abs(t.total-r.total)<0.005)<>{len(x[name])} THEN RAISE EXCEPTION 'Item mismatch'; END IF; END $$;''')
sql.append(f'''INSERT INTO audit_logs(id,action,entity,"entityId",message,"userId","organizationId",metadata) SELECT {q(batch)},'import.commit','ImportBatch',{q(batch)},'Imported 20 fully paid workshop acts with new invoice numbers',uid,oid,{q(json.dumps(decisions))}::jsonb FROM ctx ON CONFLICT(id) DO NOTHING;
SELECT json_build_object('orders',count(*),'total',sum(s."totalAmount"::numeric),'fullyPaid',bool_and(s."manuallyPaid"),'numbers',json_agg(s."invoiceNumber" ORDER BY r.position)) FROM service_records s JOIN st_records r ON r.id=s.id;
COMMIT;''')
(p/'import.sql').write_text('\n'.join(sql));(p/'batch.json').write_text(json.dumps({'id':batch}))
print('SQL prepared:',len(x['records']),'orders')
