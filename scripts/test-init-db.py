"""Exercise startup migration decisions without a database or external commands."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'init-db.sh'
STUB = r'''
import os, pathlib, sys
name = pathlib.Path(sys.argv[0]).name
with open(os.environ['CALLS'], 'a') as f:
    f.write(name + ' ' + ' '.join(sys.argv[1:]) + '\n')
if name == 'npx' and sys.argv[1:] == ['prisma', 'migrate', 'deploy']:
    marker = pathlib.Path(os.environ['CALLS'] + '.attempted')
    if not marker.exists():
        marker.touch()
        print(os.environ['MIGRATION_ERROR'], file=sys.stderr)
        sys.exit(int(os.environ['MIGRATION_STATUS']))
'''


class MigrationStartupTests(unittest.TestCase):
    def run_startup(self, error='', status=0):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ('npx', 'pg_isready', 'node', 'test-app'):
                executable = root / name
                executable.write_text('#!' + sys.executable + '\n' + STUB)
                executable.chmod(0o755)
            calls = root / 'calls'
            result = subprocess.run(
                ['bash', str(SCRIPT), 'test-app'], text=True, capture_output=True,
                env={**os.environ, 'PATH': str(root) + os.pathsep + os.environ['PATH'],
                     'DATABASE_URL': 'postgresql://localhost/test', 'CALLS': str(calls),
                     'MIGRATION_ERROR': error, 'MIGRATION_STATUS': str(status)},
            )
            return result, calls.read_text()

    def test_success_starts_application_without_baseline(self):
        result, calls = self.run_startup()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('test-app ', calls)
        self.assertNotIn('db execute', calls)

    def test_only_p3005_uses_legacy_baseline(self):
        result, calls = self.run_startup('Error: P3005\nDatabase schema is not empty.', 1)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('db execute', calls)
        self.assertEqual(calls.count('npx prisma migrate deploy'), 2)
        self.assertIn('test-app ', calls)

    def test_other_failures_preserve_diagnostic_and_do_not_modify_database(self):
        for error, status in [('Error: No space left on device', 28),
                              ('Error: P1001\nCannot reach database', 1),
                              ('Error: P3009\nFailed migration exists', 1)]:
            with self.subTest(error=error):
                result, calls = self.run_startup(error, status)
                self.assertEqual(result.returncode, status)
                self.assertIn(error, result.stderr)
                self.assertNotIn('db execute', calls)
                self.assertNotIn('test-app ', calls)
                self.assertEqual(calls.count('npx prisma migrate deploy'), 1)
                self.assertNotIn('Existing database detected', result.stdout)


if __name__ == '__main__':
    unittest.main()
