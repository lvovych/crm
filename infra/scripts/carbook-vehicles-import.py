#!/usr/bin/env python3
"""Prepare an atomic vehicle import, with exact Carbook owner IDs and no financial data."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path

os.umask(0o077)
root = Path(__file__).resolve().parents[1] / '.secrets/carbook'
spec = importlib.util.spec_from_file_location('customers', Path(__file__).with_name('carbook-import.py'))
customers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(customers)
quote = customers.literal
org = json.loads((root / 'import-manifest.json').read_text())['organizationId']
clients = {c['clientId']: c for c in json.loads((root / 'clients-with-vehicle-owners.json').read_text())}
accounts = {c['accountId'] for c in clients.values()}
assert len(accounts) == 1
account = next(iter(accounts))
raw = (root / 'vehicles.json').read_bytes()
vehicles = json.loads(raw)
assert len(vehicles) == 1630 and len({v['clientVehicleId'] for v in vehicles}) == 1630
rows = []
for v in vehicles:
    cid = v['client']['clientId']
    assert cid is None or cid in clients
    assert v['make'] and v['model'] and 1886 <= v['year'] <= 2028
    assert v.get('mileage') is None or (isinstance(v['mileage'], int) and v['mileage'] >= 0)
    vid = 'carbook_vehicle_' + hashlib.sha256(f"{org}:{account}:{v['clientVehicleId']}".encode()).hexdigest()[:32]
    note = f"Імпорт із Carbook. ID автомобіля: {v['clientVehicleId']}."
    note += f"\nID клієнта Carbook: {cid}." if cid is not None else '\nУ Carbook автомобіль не має прив’язаного клієнта.'
    if v.get('modification'):
        note += '\nМодифікація: ' + v['modification']
    if not v.get('mileage'):
        note += '\nПробіг у джерелі не вказаний або дорівнює нулю.'
    rows.append({'id': vid, 'customerId': customers.customer(clients[cid], org)['id'] if cid is not None else None,
                 'make': v['make'], 'model': v['model'], 'year': v['year'],
                 'vin': v.get('vin') or None, 'licensePlate': v.get('number') or None,
                 'mileage': v.get('mileage') or 0, 'note': note})
digest = hashlib.sha256(raw).hexdigest()
batch = 'carbook_vehicles_' + hashlib.sha256((org + digest).encode()).hexdigest()[:32]
qorg, qbatch = quote(org), quote(batch)
sql = f'''\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL standard_conforming_strings = on;
SET LOCAL lock_timeout = '15s';
LOCK TABLE vehicles IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE vehicle_context AS SELECT u.id AS uid, m."organizationId" AS oid
FROM users u JOIN organization_members m ON m."userId"=u.id
WHERE u.email='ceo@lauto.com.ua' AND m."organizationId"={qorg} AND m.role='owner';
CREATE TEMP TABLE incoming_vehicles AS SELECT * FROM jsonb_to_recordset({quote(json.dumps(rows,ensure_ascii=False))}::jsonb)
AS x(id text, "customerId" text, make text, model text, year int, vin text, "licensePlate" text, mileage int, note text);
DO $$ BEGIN
 IF (SELECT count(*) FROM vehicle_context) <> 1 THEN RAISE EXCEPTION 'Owner context mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM incoming_vehicles i LEFT JOIN customers c ON c.id=i."customerId" AND c."organizationId"={qorg}
 WHERE i."customerId" IS NOT NULL AND c.id IS NULL) THEN RAISE EXCEPTION 'Missing vehicle owner'; END IF;
 IF EXISTS(SELECT 1 FROM vehicles WHERE "organizationId"={qorg} AND id NOT IN (SELECT id FROM incoming_vehicles))
 THEN RAISE EXCEPTION 'Existing vehicles require duplicate review'; END IF;
 IF EXISTS(SELECT 1 FROM vehicles v JOIN incoming_vehicles i ON i.id=v.id WHERE v."organizationId" IS DISTINCT FROM {qorg}
 OR v."customerId" IS DISTINCT FROM i."customerId") THEN RAISE EXCEPTION 'Conflicting existing vehicle identity'; END IF;
END $$;
INSERT INTO import_batches (id,"organizationId","userId",source,entity,"fileName",status,"totalRows",created,updated,skipped,failed,mapping,"createdAt")
SELECT {qbatch},oid,uid,'carbook','vehicles','vehicles.json','completed',1630,0,0,0,0,
jsonb_build_object('sha256',{quote(digest)},'ownerMatching','Carbook accountId + clientId'),now() FROM vehicle_context ON CONFLICT(id) DO NOTHING;
INSERT INTO vehicles (id,"customerId",make,model,year,vin,"licensePlate",mileage,"fuelType",transmission,"userId","organizationId","importBatchId","createdAt","updatedAt")
SELECT i.id,i."customerId",i.make,i.model,i.year,i.vin,i."licensePlate",i.mileage,NULL,NULL,c.uid,c.oid,{qbatch},now(),now()
FROM incoming_vehicles i CROSS JOIN vehicle_context c WHERE NOT EXISTS(SELECT 1 FROM vehicles v WHERE v.id=i.id);
INSERT INTO notes (id,title,content,"vehicleId","createdAt","updatedAt")
SELECT id || '_source','Дані з Carbook',note,id,now(),now() FROM incoming_vehicles ON CONFLICT(id) DO NOTHING;
UPDATE import_batches SET created=(SELECT count(*) FROM vehicles WHERE "importBatchId"={qbatch}),
 skipped=1630-(SELECT count(*) FROM vehicles WHERE "importBatchId"={qbatch}) WHERE id={qbatch};
DO $$ BEGIN
 IF (SELECT count(*) FROM vehicles v JOIN incoming_vehicles i ON v.id=i.id
 WHERE v."organizationId"={qorg} AND v."customerId" IS NOT DISTINCT FROM i."customerId"
 AND v.make=i.make AND v.model=i.model AND v.year=i.year AND v.vin IS NOT DISTINCT FROM i.vin
 AND v."licensePlate" IS NOT DISTINCT FROM i."licensePlate" AND v.mileage=i.mileage) <> 1630
 THEN RAISE EXCEPTION 'Vehicle fields/owner verification failed'; END IF;
END $$;
INSERT INTO audit_logs (id,action,entity,"entityId",message,"userId","organizationId",metadata)
SELECT {qbatch},'import.commit','ImportBatch',{qbatch},'Carbook vehicles imported with source owner relationships',uid,oid,
jsonb_build_object('count',1630,'sha256',{quote(digest)}) FROM vehicle_context ON CONFLICT(id) DO NOTHING;
COMMIT;
SELECT json_build_object('vehicles',count(*),'linked',count(v."customerId"),'unassigned',count(*)-count(v."customerId"))
FROM vehicles v JOIN incoming_vehicles i ON i.id=v.id WHERE v."organizationId"={qorg};
'''
(root / 'vehicles-import.sql').write_text(sql)
manifest = {'count':len(rows),'linked':sum(r['customerId'] is not None for r in rows),'sha256':digest,'batchId':batch}
(root / 'vehicles-import-manifest.json').write_text(json.dumps(manifest,indent=2))
print(json.dumps(manifest))
