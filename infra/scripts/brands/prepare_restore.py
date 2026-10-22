#!/usr/bin/env python3
"""Prepare a repeat-safe brand-only restore from the existing private Carbook archive.
Does not connect to any server. SQL aborts on missing/moved/renamed parts or conflicts.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path

os.umask(0o077)

def source_brand(row):
    values = [str(row.get(k) or '').strip() for k in ('brandName', 'productBrandName', 'supplierBrandName')]
    if len({v.casefold() for v in values if v}) > 1:
        raise ValueError(f"Conflicting source brands on detail {row['id']}")
    return next((v for v in values if v), '---')

def prepare(directory):
    org = json.loads((directory / 'import-manifest.json').read_text())['organizationId']
    accounts = {c['accountId'] for c in json.loads((directory / 'clients-with-vehicle-owners.json').read_text())}
    if len(accounts) != 1:
        raise ValueError('Expected one source account')
    account = accounts.pop()
    def identifier(kind, source):
        return 'cb_' + kind + '_' + hashlib.sha256(f'{org}:{account}:{source}'.encode()).hexdigest()[:32]
    rows = []
    for detail in json.loads((directory / 'orders-with-details.json').read_text()):
        oid = detail['order']['id']
        for i, part in enumerate(detail['orderDetails']):
            rows.append(dict(id=identifier('part', f'{oid}:{part["id"]}:{i}'),
                             serviceRecordId=identifier('order', oid),
                             name=part.get('detailName') or part.get('productname') or 'Запчастина Carbook',
                             partNumber=part.get('detailCode') or part.get('productCode'),
                             brand=source_brand(part)))
    if len({r['id'] for r in rows}) != len(rows) or not rows:
        raise ValueError('Empty/duplicate source IDs')
    quote = lambda v: "'" + v.replace("'", "''") + "'"
    payload = quote(json.dumps(rows, ensure_ascii=False))
    sql = f'''\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '10s';
LOCK TABLE service_records, service_parts, payments IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE brand_restore ON COMMIT DROP AS
SELECT * FROM jsonb_to_recordset({payload}::jsonb)
 AS x(id text, "serviceRecordId" text, name text, "partNumber" text, brand text);
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM brand_restore b
 LEFT JOIN service_parts p ON p.id=b.id
 LEFT JOIN service_records r ON r.id=p."serviceRecordId"
 WHERE p.id IS NULL OR p."serviceRecordId" <> b."serviceRecordId"
 OR r."organizationId" IS DISTINCT FROM {quote(org)}
 OR p.name IS DISTINCT FROM b.name
 OR coalesce(p."partNumber", '') <> coalesce(b."partNumber", '')
 OR p.brand NOT IN ('---', b.brand)) THEN
 RAISE EXCEPTION 'Brand restore refused: missing/edited/moved part or existing brand conflict';
 END IF;
END $$;
CREATE TEMP TABLE brand_restore_before ON COMMIT DROP AS
SELECT 'parts' AS kind, p.id, to_jsonb(p)-'brand' AS value FROM service_parts p
UNION ALL SELECT 'orders', r.id, to_jsonb(r) FROM service_records r
UNION ALL SELECT 'payments', p.id, to_jsonb(p) FROM payments p;
UPDATE service_parts p SET brand=b.brand FROM brand_restore b
 WHERE p.id=b.id AND p.brand IS DISTINCT FROM b.brand;
DO $$ BEGIN
 IF EXISTS (
 WITH after_state AS (
 SELECT 'parts' AS kind, p.id, to_jsonb(p)-'brand' AS value FROM service_parts p
 UNION ALL SELECT 'orders', r.id, to_jsonb(r) FROM service_records r
 UNION ALL SELECT 'payments', p.id, to_jsonb(p) FROM payments p)
 SELECT 1 FROM brand_restore_before b FULL JOIN after_state a USING(kind,id)
 WHERE b.value IS DISTINCT FROM a.value
 ) THEN RAISE EXCEPTION 'Non-brand data changed; rolling back'; END IF;
 IF EXISTS(SELECT 1 FROM brand_restore b JOIN service_parts p ON p.id=b.id WHERE p.brand <> b.brand)
 THEN RAISE EXCEPTION 'Brand verification failed'; END IF;
END $$;
SELECT count(*) AS verified_parts, count(*) FILTER(WHERE brand <> '---') AS known_brands FROM brand_restore;
COMMIT;
'''
    (directory / 'brands-restore.sql').write_text(sql)
    print(json.dumps({'parts': len(rows), 'known': sum(r['brand'] != '---' for r in rows), 'unknown': sum(r['brand'] == '---' for r in rows)}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, required=True)
    prepare(parser.parse_args().archive)
