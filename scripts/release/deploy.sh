#!/usr/bin/env bash
# Runs over SSH on the existing CRM host; never provisions or replaces secrets.
set -Eeuo pipefail
umask 077
image=${1:?image digest required}
tag=${2:?release tag required}
actor=${3:?registry user required}
[[ "$image" =~ ^ghcr\.io/lvovych/crm@sha256:[a-f0-9]{64}$ ]]
[[ "$tag" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]
[[ $(id -u) == 0 ]]
cd /srv/crm
[[ -f compose.yml && -f .env ]]
# This backup already stops writers, copies DB + files and verifies remote upload.
# Its own maintenance lock must be released before the deployment acquires it.
systemctl start crm-backup.service
[[ $(systemctl show crm-backup.service -p Result --value) == success ]]
exec 9>/run/lock/crm-maintenance.lock
flock -n 9
export DOCKER_CONFIG
DOCKER_CONFIG=$(mktemp -d /tmp/crm-release-registry.XXXXXX)
cleanup() { rm -rf -- "$DOCKER_CONFIG"; }
trap cleanup EXIT
printf '%s' "${REGISTRY_TOKEN:?registry token required}" | docker login ghcr.io -u "$actor" --password-stdin
unset REGISTRY_TOKEN
docker pull "$image"
# Preserve all current server settings; update only the app's immutable image.
cp -p compose.yml "compose.pre-${tag}.yml"
python3 - "$image" <<'PY'
import os
import re
import sys
from pathlib import Path
path = Path('compose.yml')
text = path.read_text()
pattern = r'(?m)(^  app:\n    image: )[^\n]+'
updated, count = re.subn(pattern, lambda m: m[1] + '"' + sys.argv[1] + '"', text)
if count != 1:
    raise SystemExit('Unexpected Compose layout; refusing to change it')
temporary = Path('compose.release.tmp.yml')
temporary.write_text(updated)
os.chmod(temporary, path.stat().st_mode & 0o777)
PY
docker compose -f compose.release.tmp.yml config --quiet
mv compose.release.tmp.yml compose.yml
# Do not auto-roll back a database migration. Keep the recovery set for an operator.
docker compose up -d --wait --wait-timeout 240 app
curl --fail --silent --show-error --max-time 20 http://127.0.0.1:3000/api/v1/health
printf '%s %s\n' "$tag" "$image" > /srv/crm/deployed-release
