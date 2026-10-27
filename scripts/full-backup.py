#!/usr/bin/env python3
"""Offline whole-database disaster recovery, including immutable ledger and file stores.
Never overwrites a database or file directory. Run only with all writers stopped.
PostgreSQL tools run inside an explicitly named Docker database container.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
from datetime import datetime, timezone

STORES = ('uploads', 'ledger-documents', 'ledger-imports')


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def command(args, stdin=None, stdout=subprocess.PIPE):
    return subprocess.run(args, stdin=stdin, stdout=stdout, stderr=subprocess.PIPE, check=True).stdout


def pg(args, tool, *options, stdin=None, stdout=subprocess.PIPE):
    return command(['docker', 'exec', '-i', args.db_container, tool, '-U', args.db_user, *options], stdin, stdout)


def sql(args, database, query):
    return pg(args, 'psql', '-X', '-d', database, '-At', '-v', 'ON_ERROR_STOP=1', '-c', query).decode().strip()


def identifier(name):
    return '"' + name.replace('"', '""') + '"'


def fingerprints(args, database):
    # Discover EVERY public table, including new ledger models and migrations.
    tables = json.loads(sql(args, database, "SELECT coalesce(json_agg(tablename ORDER BY tablename),'[]'::json) FROM pg_tables WHERE schemaname='public'"))
    result = {}
    for table in tables:
        data = sql(args, database, f'SELECT count(*),md5(coalesce(string_agg(row_to_json(t)::text,E\'\\n\' ORDER BY row_to_json(t)::text),\'\')) FROM public.{identifier(table)} t')
        count, checksum = data.split('|')
        result[table] = {'rows': int(count), 'digest': checksum}
    return result


def file_inventory(root):
    result = {}
    if not root.exists():
        return result
    if root.is_symlink() or not root.is_dir():
        raise ValueError('File store must be a real directory')
    for path in sorted(root.rglob('*')):
        if path.is_symlink() or not (path.is_file() or path.is_dir()):
            raise ValueError('Symlinks and special files are not supported in file stores')
        if path.is_file():
            result[path.relative_to(root).as_posix()] = {'bytes': path.stat().st_size, 'sha256': digest(path)}
    return result


def verify_ledger_files(args, database, roots):
    for table, store, checksum in [('ledger_attachments', 'ledger-documents', 'sha256'),
                                    ('ledger_import_tasks', 'ledger-imports', 'fileHash')]:
        if sql(args, database, f"SELECT to_regclass('public.{table}') IS NOT NULL") != 't':
            continue
        query = f'SELECT coalesce(json_agg(t),\'[]\'::json) FROM (SELECT "storageKey",size,"{checksum}" AS hash FROM public.{identifier(table)}) t'
        for row in json.loads(sql(args, database, query)):
            key = row['storageKey']
            if not re.fullmatch(r'[a-f0-9-]{36}', key):
                raise ValueError('Invalid ledger file key')
            file = roots[store] / key
            if not file.is_file() or file.is_symlink() or file.stat().st_size != row['size'] or digest(file) != row['hash']:
                raise ValueError('A ledger document/import file is missing or corrupt; backup/restore is incomplete')


def archive_store(root, target, fallback=None):
    primary = file_inventory(root)
    legacy = file_inventory(fallback) if fallback else {}
    before = {**legacy, **primary}
    with tarfile.open(target, 'w:gz') as archive:
        for relative in before:
            archive.add((root if relative in primary else fallback) / relative, arcname=relative, recursive=False)
    if file_inventory(root) != primary or (fallback and file_inventory(fallback) != legacy):
        raise ValueError('Files changed during backup; stop all writers and retry')
    return before


def validate_archive(path, expected):
    seen = set()
    with tarfile.open(path, 'r:gz') as archive:
        for entry in archive:
            parts = PurePosixPath(entry.name)
            if (not entry.isfile() or parts.is_absolute() or '..' in parts.parts
                    or '\\' in entry.name or entry.name in seen or entry.name not in expected):
                raise ValueError('Unsafe or unexpected archive member')
            seen.add(entry.name)
            meta = expected[entry.name]
            if entry.size != meta['bytes']:
                raise ValueError('Archive size mismatch')
            h = hashlib.sha256()
            with archive.extractfile(entry) as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b''):
                    h.update(block)
            if h.hexdigest() != meta['sha256']:
                raise ValueError('File checksum mismatch')
    if seen != set(expected):
        raise ValueError('Missing files in archive')


def extract_archive(path, target):
    # Called only after full validation. No tar extraction or stored permissions.
    target.mkdir(mode=0o700)
    with tarfile.open(path, 'r:gz') as archive:
        for entry in archive:
            dest = target / entry.name
            dest.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with archive.extractfile(entry) as source, open(dest, 'xb') as output:
                shutil.copyfileobj(source, output)
            dest.chmod(0o600)


def backup(args):
    output = Path(args.output).resolve()
    roots = {'uploads': Path(args.uploads).resolve()}
    roots['ledger-documents'] = Path(args.ledger_attachment_storage).resolve() if args.ledger_attachment_storage else roots['uploads'] / 'ledger-documents'
    roots['ledger-imports'] = Path(args.ledger_import_storage).resolve() if args.ledger_import_storage else roots['uploads'] / 'ledger-imports'
    if not roots['uploads'].is_dir():
        raise ValueError('Uploads directory does not exist')
    fallback = Path(args.legacy_uploads).resolve() if args.legacy_uploads else None
    if fallback and not fallback.is_dir():
        raise ValueError('Legacy uploads directory does not exist')
    for root in [*roots.values(), *([fallback] if fallback else [])]:
        if root == output or root in output.parents:
            raise ValueError('Backup output must be outside file stores')
    output.mkdir(mode=0o700)  # never overwrite an existing backup
    verify_ledger_files(args, args.database, roots)
    before = fingerprints(args, args.database)
    with open(output / 'database.dump', 'xb') as dump:
        pg(args, 'pg_dump', '-d', args.database, '-Fc', '--no-owner', '--no-acl', stdout=dump)
    stores = {}
    for name, root in roots.items():
        archive = output / (name + '.tar.gz')
        files = archive_store(root, archive, fallback if name == 'uploads' else None)
        stores[name] = {'sha256': digest(archive), 'files': files}
    if fingerprints(args, args.database) != before:
        raise ValueError('Database changed during backup; stop all writers and retry')
    manifest = {'format': 1, 'createdAt': datetime.now(timezone.utc).isoformat(),
                'databaseSha256': digest(output / 'database.dump'), 'tables': before,
                'stores': stores}
    # A directory without this last marker is an incomplete backup.
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'result': 'PASS', 'backup': str(output), 'tables': len(before),
                      'files': sum(len(s['files']) for s in stores.values())}))


def restore(args):
    source = Path(args.backup).resolve()
    manifest = json.loads((source / 'manifest.json').read_text())
    if manifest.get('format') != 1 or set(manifest.get('stores', {})) != set(STORES):
        raise ValueError('Unsupported or incomplete full backup')
    if digest(source / 'database.dump') != manifest['databaseSha256']:
        raise ValueError('Database checksum mismatch')
    for name in STORES:
        store = manifest['stores'][name]
        archive = source / (name + '.tar.gz')
        if digest(archive) != store['sha256']:
            raise ValueError('Archive checksum mismatch')
        validate_archive(archive, store['files'])
    target = Path(args.output_files).resolve()
    if target.exists():
        raise ValueError('Restore requires a new file directory')
    # createdb is the race-safe existence guard. No DROP, --clean or overwrite.
    pg(args, 'createdb', '-T', 'template0', args.database)
    try:
        with open(source / 'database.dump', 'rb') as dump:
            pg(args, 'pg_restore', '-d', args.database, '--no-owner', '--no-acl', '--exit-on-error', '--single-transaction', stdin=dump)
        if fingerprints(args, args.database) != manifest['tables']:
            raise ValueError('Restored database differs from backup')
        target.mkdir(mode=0o700)
        for name in STORES:
            extract_archive(source / (name + '.tar.gz'), target / name)
        verify_ledger_files(args, args.database, {name: target / name for name in STORES})
        (target / 'restore-verified.json').write_text(json.dumps({'database': args.database, 'verifiedAt': datetime.now(timezone.utc).isoformat()}) + '\n')
    except Exception:
        # Keep failed targets for diagnosis; never erase anything automatically.
        raise RuntimeError('Restore did not verify; target is NOT ready for use. Original database was not modified.') from None
    print(json.dumps({'result': 'PASS', 'database': args.database, 'files': str(target), 'tables': len(manifest['tables'])}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db-container', required=True)
    parser.add_argument('--db-user', required=True)
    parser.add_argument('--database', required=True)
    sub = parser.add_subparsers(dest='action', required=True)
    make = sub.add_parser('backup')
    make.add_argument('--writers-stopped', action='store_true', required=True)
    make.add_argument('--uploads', required=True)
    make.add_argument('--legacy-uploads', help='Old fallback uploads directory; merged using application lookup precedence')
    make.add_argument('--ledger-attachment-storage')
    make.add_argument('--ledger-import-storage')
    make.add_argument('--output', required=True)
    load = sub.add_parser('restore')
    load.add_argument('--backup', required=True)
    load.add_argument('--output-files', required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]*', args.database):
        parser.error('Database must be a simple name, not a connection URL or command option')
    for value in (args.db_user, args.db_container):
        if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]*', value):
            parser.error('Invalid container or user name')
    os.umask(0o077)
    try:
        backup(args) if args.action == 'backup' else restore(args)
    except subprocess.CalledProcessError as error:
        # Do not print arbitrary server output, connection details, or database rows.
        parser.exit(1, f'PostgreSQL/Docker command failed (exit {error.returncode}); no successful backup/restore marker was written.\n')
    except (ValueError, RuntimeError, OSError, KeyError) as error:
        parser.exit(1, f'{error}\n')


if __name__ == '__main__':
    main()
