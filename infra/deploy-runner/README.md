# Dedicated production deployment runner

This prepares a separate Ubuntu 24.04 x86_64 machine with a persistent public
IPv4. It runs only the release workflow's `deploy` job; tests and multi-platform
image builds stay on GitHub-hosted runners. Do not install it on the CRM host.
The runner account has no sudo or Docker access. Production credentials remain
in GitHub's `production` environment and are removed from runner temporary files
after the SSH step. The runner registration credential remains on this machine;
treat the host and its disk as privileged infrastructure.

## Activation prerequisite

`lvovych/crm` is currently a **public personal repository**. Labels route jobs;
they are not an authorization boundary. Do not activate a persistent repository
runner while the repository is public. `register.sh` refuses this case.

The supported activation path for these scripts is an operator-approved change
to a private repository. If the repository must remain public, use an
organization-owned runner group restricted to approved release workflows and
adapt registration and workflow routing first. Do not remove the visibility
guard just to make registration succeed. No visibility change is automated.

GitHub guidance:
https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/manage-access

## Provision a new host (operator)

This Terraform root has its **own state** and does not manage CRM containers or
the production server. It creates a billable VM and reserved IPv4. Keep its state
secure. The default server type is x86_64 `cx23`; adjust for availability.

1. Set `HCLOUD_TOKEN` securely in the operator shell for the correct project.
2. Copy `runner.tfvars.example` to `runner.tfvars`; specify the existing admin
   SSH key name and trusted admin CIDRs. Real tfvars/state are ignored by Git.
3. Run from this directory:

   ```sh
   terraform init
   terraform plan -var-file=runner.tfvars -out=runner.tfplan
   # Review: only the new runner, its firewall and reserved IPv4.
   terraform apply runner.tfplan
   terraform output -raw runner_ipv4
   terraform output -raw production_ssh_cidr
   ```

4. Verify the new host's SSH fingerprint via the provider console before adding
   its host key to the operator's known_hosts. Never disable host-key checking.
5. Allow the output `production_ssh_cidr` on **production's** firewall, TCP 22.
   `infra/terraform` now accepts `deploy_runner_cidrs = ["RUNNER_IPV4/32"]` in its
   existing production variables. Review the production plan against the live
   infrastructure: apply only after resolving unrelated drift. Preserve admin,
   HTTP and HTTPS rules. Do not allow all GitHub/Azure ranges or `0.0.0.0/0`.
   The runner needs outbound DNS/HTTPS and TCP 22 to production; it needs no
   incoming connection from GitHub. Its own SSH is restricted to admin CIDRs.
6. Install from this directory (replace shell variables with actual values):

   ```sh
   ssh -i "$ADMIN_KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
     "root@$RUNNER_IP" 'bash -s' < install.sh
   ```

   The pinned runner archive is SHA-256 verified. Docker and application secrets
   are not installed. GitHub runner auto-updates remain enabled.
7. Once the repository is private and the new host key is verified, register:

   ```sh
   ./register.sh "$RUNNER_IP" "$ADMIN_KEY"
   gh api repos/lvovych/crm/actions/runners \
     --jq '.runners[] | {name,status,labels:[.labels[].name]}'
   ```

   `gh` must have repository administrator permission. The short-lived
   registration token is passed over SSH stdin, not committed or added as a
   GitHub secret. The runner starts as `crm-runner` using systemd.

## Release and verification

Keep the existing three `CRM_DEPLOY_*` secrets in `production`. No additional
long-lived GitHub secret is required. The `crm_deplot.pub` key must already be
in production root's authorized_keys. Keep its private half in the environment
secret, not on the runner disk.

Merge the workflow change into `main` only after the runner is online with
labels `self-hosted`, `Linux`, `X64`, `crm-production-deploy`. Then manually
publish a new stable Release/tag from main (for example `v1.0.2`, if unused).
Follow the deploy job: release validation, full backup, digest pull, Compose
health and public health must all pass.

**Re-running v1.0.1 cannot pick up this runner change.** GitHub reruns use the
original SHA/ref and workflow (see
https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs). Do not move the immutable v1.0.1 tag or bypass the
release-only policy with an ad-hoc deployment. A new release is required for
this infrastructure fix. Once a run already uses the new runner, failed jobs
can be retried with `gh run rerun RUN_ID --failed` after resolving their cause.

## Maintenance / removal

Apply OS security updates and reboot during a release-free window. Keep this
runner reserved for trusted release jobs; do not route PR/test jobs here. Audit
workflow edits and environment access. For removal, stop the service with
`/opt/actions-runner/svc.sh stop`, remove the runner in GitHub, remove its /32
from the production firewall, then review a Terraform destroy plan. The reserved
IPv4 has `prevent_destroy` so it cannot be released accidentally.
