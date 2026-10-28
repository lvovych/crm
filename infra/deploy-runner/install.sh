#!/usr/bin/env bash
# On the NEW dedicated Ubuntu 24.04 x86_64 host, as root. Does not register/start jobs.
set -Eeuo pipefail
[[ $(id -u) == 0 && $(uname -m) == x86_64 ]]
source /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 24.04 ]]
[[ ! -e /srv/crm ]] || { echo 'Refusing to install a runner on the CRM host' >&2; exit 1; }
[[ ! -e /opt/actions-runner/.runner ]] || { echo 'Runner already registered; stop before upgrading' >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git gh python3 openssh-client libicu74 libssl3t64 zlib1g
id crm-runner >/dev/null 2>&1 || useradd --create-home --shell /bin/bash crm-runner
# No sudo privileges, Docker socket or persistent production key for this account.
install -d -m 755 -o crm-runner -g crm-runner /opt/actions-runner
archive=$(mktemp)
trap 'rm -f "$archive"' EXIT
curl --fail --silent --show-error --location \
  https://github.com/actions/runner/releases/download/v2.338.2/actions-runner-linux-x64-2.338.2.tar.gz \
  --output "$archive"
echo "baebf204307bac6193480852732f0aba2ae97b6c5597c244f4d5558390147c40  $archive" | sha256sum --check
tar -xzf "$archive" --no-same-owner -C /opt/actions-runner
chown -R crm-runner:crm-runner /opt/actions-runner
printf '%s\n' 'Installed. Register from the operator machine using register.sh.'
