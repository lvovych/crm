#!/usr/bin/env python3
"""Fingerprint original columns in the explicitly authorized, isolated restored copy."""
import json, pathlib, subprocess, sys, os
phase=sys.argv[1]
if phase not in ('before','after'): raise SystemExit('Use before or after')
container='crm-ledger-test'
database='crm_production_rehearsal_20261023'
root=pathlib.Path('tmp/ledger-production-rehearsal')
path=root/'baseline.json'
tables=['service_records','service_parts','service_labor','payments','inventory_parts','customers','vehicles']
def sql(query):
 return subprocess.run(['docker','exec',container,'psql','-U','crm_test','-d',database,'-At','-v','ON_ERROR_STOP=1','-c',query],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE).stdout.decode().strip()
def quote(name): return '"'+name.replace('"','""')+'"'
if phase=='before':
 columns={table:json.loads(sql("SELECT json_agg(column_name ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name='"+table+"'")) for table in tables}
 if any(not cols for cols in columns.values()):raise SystemExit('Expected historical table missing')
else:columns=json.loads(path.read_text())['columns']
result={}
for table,cols in columns.items():
 result[table]=sql("SELECT count(*)::text||'|'||md5(COALESCE(string_agg(row_to_json(t)::text,E'\\n' ORDER BY id),'')) FROM (SELECT "+','.join(map(quote,cols))+" FROM "+quote(table)+") t")
if phase=='before':
 path.write_text(json.dumps({'columns':columns,'fingerprints':result},indent=2));os.chmod(path,0o600)
 print('Original historical columns fingerprinted; no row data printed')
else:
 before=json.loads(path.read_text())['fingerprints']
 differences=[table for table in tables if before[table]!=result[table]]
 report={'tablesChecked':len(tables),'historicalColumnsUnchanged':not differences,'changedTables':differences}
 (root/'migration-verification.json').write_text(json.dumps(report,indent=2))
 print(json.dumps(report))
 if differences:raise SystemExit(1)
