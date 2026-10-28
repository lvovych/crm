#!/usr/bin/env python3
"""Logical backup/restore drill ONLY for the isolated Docker acceptance stack."""
import hashlib
import json
import pathlib
import subprocess
import tarfile
import tempfile
import uuid

DB_CONTAINER = 'crm-ledger-acceptance-db-1'
APP_CONTAINER = 'crm-ledger-acceptance-app-1'
SOURCE = 'crm_ledger_test'
TARGET = 'crm_ledger_restore_' + uuid.uuid4().hex[:12]
TABLES = ['inventory_parts', 'service_records', 'payments', 'inventory_documents',
          'inventory_document_lines', 'stock_lots', 'inventory_ledger_entries',
          'stock_lot_balances', 'stock_reservations', 'reservation_events',
          'settlement_entries', 'settlement_allocations', 'cash_ledger_entries',
          'money_transactions', 'customer_adjustments', 'ledger_import_tasks',
          'supplier_service_documents', 'supplier_service_lines', 'ledger_attachments',
          'ledger_migration_batches', 'units_of_measure', 'warehouse_locations',
          'supplier_products', '_prisma_migrations']
OUT = pathlib.Path('test-results/stock-ledger/restore')
OUT.mkdir(parents=True, exist_ok=True)

def command(args, data=None):
    return subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True).stdout

def sql(database, query):
    return command(['docker', 'exec', DB_CONTAINER, 'psql', '-U', 'crm_test', '-d', database, '-At', '-v', 'ON_ERROR_STOP=1', '-c', query]).decode().strip()

def fingerprints(database):
    result = {}
    for table in TABLES:
        # Tables are a constant allowlist, never user input.
        text = sql(database, f'SELECT count(*),md5(COALESCE(string_agg(to_jsonb(t)::text, E\'\\n\' ORDER BY id),\'\')) FROM "{table}" t')
        count, digest = text.split('|')
        result[table] = {'count': int(count), 'digest': digest}
    return result

def files(archive):
    result = {}
    with tarfile.open(archive) as tar:
        for member in tar:
            if member.isfile():
                result[member.name] = hashlib.sha256(tar.extractfile(member).read()).hexdigest()
    return result

# Target is newly created, random, and on the isolated DB container. Production URLs are not accepted.
created = False
try:
    before = fingerprints(SOURCE)
    dump = command(['docker', 'exec', DB_CONTAINER, 'pg_dump', '-U', 'crm_test', '-d', SOURCE, '-Fc', '--no-owner', '--no-acl'])
    (OUT / 'database.dump').write_bytes(dump)
    command(['docker', 'exec', DB_CONTAINER, 'createdb', '-U', 'crm_test', TARGET]); created = True
    command(['docker', 'exec', '-i', DB_CONTAINER, 'pg_restore', '-U', 'crm_test', '-d', TARGET, '--no-owner', '--no-acl', '--exit-on-error'], dump)
    after = fingerprints(TARGET)
    if before != after:
        raise RuntimeError('Restored database differs from source. Stop concurrent test writes before retrying.')
    upload_archive = command(['docker', 'exec', APP_CONTAINER, 'tar', '-C', '/app/data/uploads', '-cf', '-', '.'])
    archive = OUT / 'uploads.tar'; archive.write_bytes(upload_archive)
    with tempfile.TemporaryDirectory(prefix='ledger-restore-') as directory:
        with tarfile.open(archive) as tar:
            for member in tar:
                relative = pathlib.PurePosixPath(member.name)
                if relative.is_absolute() or '..' in relative.parts or not (member.isfile() or member.isdir()):
                    raise RuntimeError('Unsafe backup archive member')
                destination = pathlib.Path(directory).joinpath(*relative.parts)
                if member.isdir():
                    destination.mkdir(parents=True, exist_ok=True)
                else:
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    destination.write_bytes(tar.extractfile(member).read())
        restored = {'./' + str(p.relative_to(directory)): hashlib.sha256(p.read_bytes()).hexdigest()
                    for p in pathlib.Path(directory).rglob('*') if p.is_file()}
        original = files(archive)
        if restored != original:
            raise RuntimeError('Restored attachment hashes differ')
    report = {'scope': 'isolated Docker fixture data only; not a production-copy rehearsal',
              'database': before, 'uploads': {'files': len(original), 'sha256': hashlib.sha256(upload_archive).hexdigest()},
              'backupSha256': hashlib.sha256(dump).hexdigest(), 'result': 'PASS'}
    (OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps({'result': 'PASS', 'tables': len(before), 'files': len(original), 'report': str(OUT / 'report.json')}))
finally:
    if created:
        command(['docker', 'exec', DB_CONTAINER, 'dropdb', '-U', 'crm_test', TARGET])
