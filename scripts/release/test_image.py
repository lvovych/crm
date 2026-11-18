"""Release image contract: one native CAX build, deployed by its exact digest."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = (ROOT / '.github/workflows/crm-image.yml').read_text()


class ReleaseImageTests(unittest.TestCase):
    def test_one_native_arm_build_preserves_deploy_output(self):
        self.assertIn('runs-on: ubuntu-24.04-arm', WORKFLOW)
        self.assertIn('platforms: linux/arm64', WORKFLOW)
        self.assertNotIn('matrix:', WORKFLOW)
        self.assertNotIn('linux/amd64', WORKFLOW)
        self.assertNotIn('  manifest:', WORKFLOW)
        self.assertIn('value: ${{ jobs.build.outputs.image }}', WORKFLOW)
        self.assertIn('image: ${{ steps.reference.outputs.image }}', WORKFLOW)
        deploy = (ROOT / '.github/workflows/deploy-prod.yml').read_text()
        self.assertIn('IMAGE: ${{ needs.image.outputs.image }}', deploy)

    def test_reference_uses_build_digest_and_rejects_invalid_values(self):
        script = WORKFLOW.split('      - name: Export immutable image reference', 1)[1].split('        run: |\n', 1)[1]
        script = '\n'.join(line[10:] for line in script.splitlines())
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'output'
            summary = Path(directory) / 'summary'
            for digest in ['sha256:' + 'a' * 64, '', 'latest', 'sha256:123', 'sha256:' + 'g' * 64]:
                output.write_text('')
                result = subprocess.run(['bash', '-c', script], env=dict(
                    os.environ, DIGEST=digest, VERSION='v1.2.3',
                    GITHUB_OUTPUT=str(output), GITHUB_STEP_SUMMARY=str(summary),
                ), capture_output=True, text=True)
                if digest == 'sha256:' + 'a' * 64:
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(output.read_text(), f'image=ghcr.io/lvovych/crm@{digest}\n')
                else:
                    self.assertNotEqual(result.returncode, 0)
                    self.assertEqual(output.read_text(), '')
