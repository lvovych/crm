#!/usr/bin/env python3
"""Fail closed before building or deploying a manually published main release."""
import json
import os
import re
import subprocess


def git(*args):
    return subprocess.check_output(['git', *args], text=True).strip()


def validate(event, event_name, expected_sha):
    release = event.get('release', {})
    if event_name != 'release' or event.get('action') != 'published':
        raise ValueError('Only release.published may deploy')
    if release.get('draft', True) or release.get('prerelease', True):
        raise ValueError('Drafts and prereleases cannot deploy production')
    tag = release.get('tag_name', '')
    if not re.fullmatch(r'v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', tag):
        raise ValueError('Expected a stable vX.Y.Z release tag')
    if release.get('target_commitish') != 'main':
        raise ValueError('Create the release with Target: main')
    sha = git('rev-parse', '--verify', f'refs/tags/{tag}^{{commit}}')
    if sha != expected_sha or git('rev-parse', 'HEAD') != sha:
        raise ValueError('Tag, event SHA and checked-out commit must match')
    if subprocess.run(['git', 'merge-base', '--is-ancestor', sha, 'refs/remotes/origin/main']).returncode:
        raise ValueError('Release commit is not in origin/main')
    return tag, sha


if __name__ == '__main__':
    with open(os.environ['GITHUB_EVENT_PATH']) as source:
        event = json.load(source)
    tag, sha = validate(event, os.environ['GITHUB_EVENT_NAME'], os.environ['GITHUB_SHA'])
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write(f'tag={tag}\nsha={sha}\n')
    print(f'Validated {tag} at {sha} on main')
