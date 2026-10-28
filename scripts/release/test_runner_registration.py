"""Never register a privileged persistent runner for a public repository."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[2] / 'infra/deploy-runner/register.sh'


class RunnerRegistrationTests(unittest.TestCase):
    def test_public_repository_cannot_issue_token_or_connect(self):
        self.check_rejected('public')

    def test_api_failure_cannot_issue_token_or_connect(self):
        self.check_rejected('', fail=True)

    def check_rejected(self, visibility, fail=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'key').touch()
            (root / 'gh').write_text(
                '#!/bin/sh\n'
                'if [ "$*" != "api repos/lvovych/crm --jq .visibility" ]; then\n'
                '  touch "$MARKER"; exit 99\nfi\n'
                + ('exit 1\n' if fail else f'echo {visibility}\n')
            )
            (root / 'ssh').write_text('#!/bin/sh\ntouch "$MARKER"\nexit 99\n')
            for name in ['gh', 'ssh']:
                (root / name).chmod(0o755)
            result = subprocess.run(
                ['bash', str(SCRIPT), '203.0.113.10', str(root / 'key')],
                env={**os.environ, 'PATH': f'{root}:{os.environ["PATH"]}',
                     'MARKER': str(root / 'unsafe-operation')},
                capture_output=True, text=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((root / 'unsafe-operation').exists())
            if not fail:
                self.assertIn('Refusing persistent repository runner', result.stderr)


if __name__ == '__main__':
    unittest.main()
