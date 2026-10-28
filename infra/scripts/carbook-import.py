#!/usr/bin/env python3
"""Prepare a transactional, repeatable customer-only import from a frozen JSON export.

Prints only counts. Writes private SQL; run it with psql ON_ERROR_STOP=1 after backup.
No debts, vehicles, invoices, orders or messaging jobs are created.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path


def clean(value):
    return str(value).strip() if value is not None else ''


def customer(source, organization_id):
    source_id = clean(source['clientId'])
    key = f"{organization_id}:{source['accountId']}:{source_id}"
    identifier = 'carbook_' + hashlib.sha256(key.encode()).hexdigest()[:32]
    name = ' '.join(filter(None, (clean(source.get(k)) for k in ['surname', 'name', 'middleName'])))
    if not name:
        raise ValueError('Source customer has no name')
    phones = list(dict.fromkeys(filter(None, map(clean, source.get('phones') or []))))
    emails = list(dict.fromkeys(filter(None, map(clean, source.get('emails') or []))))
    phone = phones[0] if phones else None
    if phone and phone.isdigit() and 11 <= len(phone) <= 15:
        phone = '+' + phone
    notes = [f'Імпорт із Carbook. ID клієнта: {source_id}.']
    if source.get('comment'):
        notes += [clean(source['comment'])]
    if len(phones) > 1:
        notes += ['Додаткові телефони: ' + ', '.join(phones[1:])]
    if len(emails) > 1:
        notes += ['Додаткові email: ' + ', '.join(emails[1:])]
    for key, label in [('birthday', 'Дата народження'), ('status', 'Статус у Carbook'),
                       ('type', 'Тип клієнта у Carbook')]:
        if source.get(key):
            notes += [label + ': ' + clean(source[key])]
    if source.get('disabled'):
        notes += ['Клієнт був неактивний у Carbook.']
    if source.get('isDefault'):
        notes += ['Стандартний клієнт Carbook.']
    return {'id': identifier, 'name': name, 'phone': phone,
            'email': emails[0] if emails else None,
            'company': name if source.get('type') in ['ENTREPRENEUR', 'LIMITED_LIABILITY_COMPANY'] else None,
            'notes': '\n\n'.join(notes),
            'reminderOptOut': bool(source.get('disableSms') or source.get('disableAutoSms'))}


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def prepare(path, organization_id, owner_email, expected):
    os.umask(0o077)
    raw = path.read_bytes()
    sources = json.loads(raw)
    identities = {(c['accountId'], c['clientId']) for c in sources}
    if len(sources) != expected or len(identities) != expected:
        raise ValueError('Source count/unique IDs do not match the expected total')
    if len({c['accountId'] for c in sources}) != 1:
        raise ValueError('Multiple source accounts require an explicit mapping')
    rows = [customer(c, organization_id) for c in sources]
    digest = hashlib.sha256(raw).hexdigest()
    batch = 'carbook_' + hashlib.sha256((organization_id + digest).encode()).hexdigest()[:32]
    org = literal(organization_id)
    payload = literal(json.dumps(rows, ensure_ascii=False))
    sql = f'''\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL standard_conforming_strings = on;
SET LOCAL lock_timeout = '15s';
LOCK TABLE customers IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE import_context AS
SELECT u.id AS user_id, o.id AS org_id FROM users u
JOIN organization_members m ON m."userId" = u.id
JOIN organizations o ON o.id = m."organizationId"
WHERE u.email = {literal(owner_email)} AND o.id = {org} AND m.role = 'owner';
DO $$ BEGIN
  IF (SELECT count(*) FROM import_context) <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one owner and organization';
  END IF;
END $$;
CREATE TEMP TABLE incoming AS SELECT * FROM jsonb_to_recordset({payload}::jsonb)
AS x(id text, name text, phone text, email text, company text, notes text, "reminderOptOut" boolean);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM customers WHERE "organizationId" = {org}
    AND id NOT IN (SELECT id FROM incoming)) THEN
    RAISE EXCEPTION 'Non-source customers exist; review duplicates before import';
  END IF;
  IF EXISTS (SELECT 1 FROM customers c JOIN incoming i ON i.id=c.id
    WHERE c."organizationId" IS DISTINCT FROM {org}) THEN
    RAISE EXCEPTION 'Source identity belongs to another organization';
  END IF;
END $$;
INSERT INTO import_batches
(id, "organizationId", "userId", source, entity, "fileName", status, "totalRows", created, updated, skipped, failed, mapping, "createdAt")
SELECT {literal(batch)}, org_id, user_id, 'carbook', 'customers', 'carbook-clients.json',
  'completed', {expected}, 0, 0, 0, 0,
  {literal(json.dumps({'sha256': digest, 'debts': False, 'vehicles': False, 'identity': 'Carbook accountId + clientId'}))}::jsonb, now()
FROM import_context ON CONFLICT (id) DO NOTHING;
WITH missing AS (
 SELECT i.*, row_number() OVER (ORDER BY i.id) AS n FROM incoming i
 WHERE NOT EXISTS (SELECT 1 FROM customers c WHERE c.id=i.id)
), max_number AS (
 SELECT greatest(1000, coalesce(max(CASE WHEN "customerNumber" ~ '^[0-9]{{1,9}}$'
 THEN "customerNumber"::bigint END),1000)) AS n FROM customers WHERE "organizationId"={org}
)
INSERT INTO customers (id, "customerNumber", name, phone, email, company, notes,
 "reminderOptOut", "userId", "organizationId", "importBatchId", "createdAt", "updatedAt")
SELECT i.id, (m.n+i.n)::text, i.name, i.phone, i.email, i.company, i.notes,
 i."reminderOptOut", ctx.user_id, ctx.org_id, {literal(batch)}, now(), now()
FROM missing i CROSS JOIN max_number m CROSS JOIN import_context ctx;
UPDATE import_batches SET
 created=(SELECT count(*) FROM customers WHERE "importBatchId"={literal(batch)}),
 skipped={expected}-(SELECT count(*) FROM customers WHERE "importBatchId"={literal(batch)})
WHERE id={literal(batch)};
DO $$ BEGIN
 IF (SELECT count(*) FROM customers c JOIN incoming i ON i.id=c.id
     WHERE c."organizationId"={org}) <> {expected} THEN
   RAISE EXCEPTION 'Final source/target count mismatch';
 END IF;
END $$;
INSERT INTO audit_logs (id, action, entity, "entityId", message, "userId", "organizationId", metadata)
SELECT {literal(batch)}, 'import.commit', 'ImportBatch', {literal(batch)},
 'Carbook customer import; debts and vehicles excluded', user_id, org_id,
 jsonb_build_object('count',{expected},'sha256',{literal(digest)}) FROM import_context
ON CONFLICT(id) DO NOTHING;
COMMIT;
SELECT json_build_object('sourceCount',{expected},'matchedCustomers',count(*),'batchId',{literal(batch)})
FROM customers c JOIN incoming i ON i.id=c.id WHERE c."organizationId"={org};
'''
    output = path.with_name('import.sql')
    output.write_text(sql)
    output.chmod(0o600)
    manifest = {'count': expected, 'sha256': digest, 'batchId': batch,
                'organizationId': organization_id, 'debtsImported': False, 'vehiclesImported': False}
    path.with_name('import-manifest.json').write_text(json.dumps(manifest, indent=2))
    print(json.dumps(manifest))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('json_file', type=Path)
    parser.add_argument('--organization', required=True)
    parser.add_argument('--owner-email', required=True)
    parser.add_argument('--expected', required=True, type=int)
    args = parser.parse_args()
    prepare(args.json_file, args.organization, args.owner_email, args.expected)
