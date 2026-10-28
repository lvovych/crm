"""Exercise the server script with fake system tools; never touch a real server."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).with_name('deploy.sh').read_text()
IMAGE = 'ghcr.io/lvovych/crm@sha256:' + 'a' * 64
COMPOSE = 'name: crm\nservices:\n  app:\n    image: "old@sha256:123"\n    env_file: .env\n  db:\n    image: "postgres:16"\n'


class DeployTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.app = self.root / 'app'
        self.app.mkdir()
        (self.app / 'compose.yml').write_text(COMPOSE)
        (self.app / '.env').write_text('SECRET=unchanged\n')
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        for name in ['systemctl', 'flock', 'docker', 'curl', 'id']:
            tool = self.bin / name
            tool.write_text('''#!/bin/bash
name=${0##*/}
printf '%s %s\\n' "$name" "$*" >> "$COMMAND_LOG"
if [[ "$name $1" == "$FAIL_COMMAND" ]]; then exit 1; fi
case "$name" in
  id) echo 0 ;;
  systemctl) if [[ "$1" == show ]]; then echo success; fi ;;
  docker) if [[ "$1" == login ]]; then cat >/dev/null; fi ;;
esac
''')
            tool.chmod(0o755)
        self.script = self.root / 'deploy.sh'
        self.script.write_text(SOURCE.replace('/srv/crm', str(self.app))
                              .replace('/run/lock/crm-maintenance.lock', str(self.root / 'lock'))
                              .replace('/tmp/crm-release-registry.', str(self.root / 'registry.')))

    def tearDown(self):
        self.temp.cleanup()

    def run_script(self, fail='', image=IMAGE):
        env = dict(os.environ, PATH=f'{self.bin}:{os.environ["PATH"]}',
                   REGISTRY_TOKEN='synthetic-token', COMMAND_LOG=str(self.root / 'commands'),
                   FAIL_COMMAND=fail)
        return subprocess.run(['bash', str(self.script), image, 'v1.2.3', 'release-test'],
                              env=env, capture_output=True, text=True)

    def test_success_preserves_settings_and_records_digest(self):
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        text = (self.app / 'compose.yml').read_text()
        self.assertIn(IMAGE, text)
        self.assertIn('    image: "postgres:16"', text)
        self.assertEqual((self.app / '.env').read_text(), 'SECRET=unchanged\n')
        self.assertEqual((self.app / 'compose.pre-v1.2.3.yml').read_text(), COMPOSE)
        self.assertIn(IMAGE, (self.app / 'deployed-release').read_text())
        self.assertEqual(list(self.root.glob('registry.*')), [])

    def test_backup_failure_never_pulls_or_changes_compose(self):
        result = self.run_script('systemctl start')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.app / 'compose.yml').read_text(), COMPOSE)
        self.assertNotIn('docker', (self.root / 'commands').read_text())

    def test_pull_failure_preserves_compose(self):
        self.assertNotEqual(self.run_script('docker pull').returncode, 0)
        self.assertEqual((self.app / 'compose.yml').read_text(), COMPOSE)
        self.assertEqual(list(self.root.glob('registry.*')), [])

    def test_health_failure_never_reports_success_or_rolls_back(self):
        self.assertNotEqual(self.run_script('curl --fail').returncode, 0)
        self.assertFalse((self.app / 'deployed-release').exists())
        self.assertIn(IMAGE, (self.app / 'compose.yml').read_text())

    def test_floating_image_rejected_before_backup(self):
        self.assertNotEqual(self.run_script(image='ghcr.io/lvovych/crm:latest').returncode, 0)
        self.assertFalse((self.root / 'commands').exists())

    def test_unexpected_compose_layout_refused(self):
        original = COMPOSE.replace('  app:', '  another-app:')
        (self.app / 'compose.yml').write_text(original)
        self.assertNotEqual(self.run_script().returncode, 0)
        self.assertEqual((self.app / 'compose.yml').read_text(), original)


if __name__ == '__main__':
    unittest.main()
