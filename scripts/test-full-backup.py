import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('full_backup', Path(__file__).with_name('full-backup.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class BackupFilesTest(unittest.TestCase):
    def test_roundtrip_and_tamper(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source'; source.mkdir()
            (source / 'document.pdf').write_bytes(b'ledger file')
            archive = root / 'files.tar.gz'
            expected = m.archive_store(source, archive)
            m.validate_archive(archive, expected)
            target = root / 'restored'
            m.extract_archive(archive, target)
            self.assertEqual(m.file_inventory(target), expected)
            expected['document.pdf']['sha256'] = 'wrong'
            with self.assertRaises(ValueError): m.validate_archive(archive, expected)

    def test_rejects_traversal_links_and_duplicates(self):
        for name, kind in [('../escape', tarfile.REGTYPE), ('/escape', tarfile.REGTYPE), ('link', tarfile.SYMTYPE), ('file', tarfile.REGTYPE)]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                archive = Path(directory) / 'files.tar.gz'
                with tarfile.open(archive, 'w:gz') as tar:
                    entry = tarfile.TarInfo(name); entry.type = kind
                    entry.linkname = '/etc/passwd'; entry.size = 0
                    tar.addfile(entry, io.BytesIO(b''))
                    if name == 'file': tar.addfile(entry, io.BytesIO(b''))
                expected = {name: {'bytes': 0, 'sha256': m.hashlib.sha256(b'').hexdigest()}}
                with self.assertRaises(ValueError): m.validate_archive(archive, expected)

    def test_legacy_uploads_merge_with_current_precedence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); current = root / 'current'; legacy = root / 'legacy'
            current.mkdir(); legacy.mkdir()
            (current / 'same').write_bytes(b'new')
            (legacy / 'same').write_bytes(b'old')
            (legacy / 'only-old').write_bytes(b'preserved')
            archive = root / 'files.tar.gz'
            inventory = m.archive_store(current, archive, legacy)
            m.validate_archive(archive, inventory)
            m.extract_archive(archive, root / 'restored')
            self.assertEqual((root / 'restored' / 'same').read_bytes(), b'new')
            self.assertEqual((root / 'restored' / 'only-old').read_bytes(), b'preserved')

    def test_missing_files_and_symlink_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); archive = root / 'empty.tar.gz'
            with tarfile.open(archive, 'w:gz'): pass
            with self.assertRaises(ValueError):
                m.validate_archive(archive, {'missing': {'bytes': 0, 'sha256': ''}})
            (root / 'link').symlink_to('/etc/passwd')
            with self.assertRaises(ValueError): m.file_inventory(root)


if __name__ == '__main__': unittest.main()
