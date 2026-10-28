#!/usr/bin/env bash
# Operator machine: gh authenticated as a repository administrator; verified SSH host key.
set -Eeuo pipefail
host=${1:?usage: register.sh RUNNER_IPV4 ADMIN_PRIVATE_KEY}
key=${2:?administrator SSH private key required}
[[ "$host" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]
[[ -f "$key" ]]
visibility=$(gh api repos/lvovych/crm --jq .visibility)
[[ "$visibility" == private ]] || {
  echo 'Refusing persistent repository runner for public repo. Make the repo private or design an organization runner group restricted to trusted workflows.' >&2
  exit 1
}
# The one-hour registration token goes over stdin; never a file, log or committed variable.
gh api --method POST repos/lvovych/crm/actions/runners/registration-token --jq .token |
  ssh -i "$key" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes "root@$host" '
    set -eu
    read -r token
    cd /opt/actions-runner
    test ! -f .runner
    runuser -u crm-runner -- ./config.sh --unattended --url https://github.com/lvovych/crm \
      --token "$token" --name crm-production-deploy --labels crm-production-deploy --work _work
    unset token
    ./svc.sh install crm-runner
    ./svc.sh start
  '
