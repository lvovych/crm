import copy
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from validate import validate


class ReleasePolicyTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.previous = os.getcwd()
        os.chdir(self.directory.name)
        self.git('init', '-b', 'main')
        self.git('config', 'user.name', 'Release test')
        self.git('config', 'user.email', 'release@example.test')
        self.git('commit', '--allow-empty', '-m', 'main')
        self.sha = self.git('rev-parse', 'HEAD')
        self.git('update-ref', 'refs/remotes/origin/main', self.sha)
        self.git('tag', 'v1.2.3')
        self.event = {'action': 'published', 'release': {
            'draft': False, 'prerelease': False, 'tag_name': 'v1.2.3',
            'target_commitish': 'main'}}

    def tearDown(self):
        os.chdir(self.previous)
        self.directory.cleanup()

    def git(self, *args):
        return subprocess.check_output(['git', *args], text=True, stderr=subprocess.DEVNULL).strip()

    def test_main_release(self):
        self.assertEqual(validate(self.event, 'release', self.sha), ('v1.2.3', self.sha))

    def test_annotated_tag(self):
        self.git('tag', '-fa', 'v1.2.3', '-m', 'release')
        self.test_main_release()

    def test_reject_non_release_events(self):
        for name in ['push', 'workflow_dispatch', 'workflow_call']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                validate(self.event, name, self.sha)

    def test_reject_draft_prerelease_branch_and_bad_tags(self):
        for key, value in [('draft', True), ('prerelease', True), ('target_commitish', 'feature/x'),
                           ('tag_name', 'latest'), ('tag_name', 'v01.2.3'),
                           ('tag_name', 'v1.2.3-rc.1'), ('tag_name', 'v1.2.3;echo hacked')]:
            event = copy.deepcopy(self.event)
            event['release'][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                validate(event, 'release', self.sha)

    def test_reject_unpublished(self):
        self.event['action'] = 'created'
        with self.assertRaises(ValueError):
            validate(self.event, 'release', self.sha)

    def test_reject_commit_only_on_feature_even_if_target_claims_main(self):
        self.git('checkout', '-b', 'feature')
        self.git('commit', '--allow-empty', '-m', 'feature')
        sha = self.git('rev-parse', 'HEAD')
        self.git('tag', '-f', 'v1.2.3')
        with self.assertRaises(ValueError):
            validate(self.event, 'release', sha)

    def test_reject_moved_tag(self):
        self.git('commit', '--allow-empty', '-m', 'next')
        self.git('tag', '-f', 'v1.2.3')
        with self.assertRaises(ValueError):
            validate(self.event, 'release', self.sha)

    def test_reject_wrong_checkout(self):
        self.git('commit', '--allow-empty', '-m', 'next')
        with self.assertRaises(ValueError):
            validate(self.event, 'release', self.sha)

    def test_previous_main_commit_is_valid(self):
        self.git('commit', '--allow-empty', '-m', 'next')
        self.git('update-ref', 'refs/remotes/origin/main', self.git('rev-parse', 'HEAD'))
        self.git('checkout', self.sha)
        self.test_main_release()


if __name__ == '__main__':
    unittest.main()
