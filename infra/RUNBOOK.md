# CRM production operations

## Deployment

- URL: https://crm.srv.lauto.com.ua
- VM: `crm-production`, Debian 13, CPX22, Nuremberg.
- IPv4: `162.55.182.40`; IPv6: `2a01:4f8:c2c:761c::1`.
- Data: `/srv/crm/postgres` and `/srv/crm/uploads` on the system disk.
- Backup: Restic over SFTP to `u681240.your-storagebox.de` (BX11, Helsinki).
- All commands below start from `infra/ansible`, unless stated otherwise.

Application, PostgreSQL and Caddy images are pinned by digest.
Production releases are made manually in GitHub; deployment is performed only by
`.github/workflows/deploy-prod.yml` on `release: published`.

### Release procedure

1. Merge reviewed, tested changes into `main`.
2. In GitHub → Releases → Draft a new release, choose **Target: main** and
   create a **new** stable tag `vX.Y.Z` (for example `v1.2.40`).
3. Write the release notes and click **Publish release**. Do not mark it as a
   prerelease. A draft, bare tag push, ordinary main push or manual workflow
   dispatch does not deploy.
4. Follow **CRM release and production deploy** in Actions. It checks that the
   tag resolves to the event commit, that the commit belongs to `origin/main`,
   and that the release targets `main`. It checks SSH configuration, runs lint
   and tests, builds native AMD64/ARM64 images and deploys the manifest digest.
5. Deployment backs up the existing DB and files using `crm-backup.service`,
   takes the maintenance lock, pulls the exact image and updates only the app
   image in `/srv/crm/compose.yml`. Existing `.env`, DB and proxy settings are
   retained. Compose health checks and public HTTPS must pass.

Release tags must never be moved or reused. Publish a new version to retry a
changed commit. Re-running a failed Actions run uses the same tagged source.
No automatic database rollback is attempted on failure: migrations may already
have run. Inspect the failure and recovery set before taking recovery action.
For a code rollback, revert the relevant changes on main and publish a new
release, after checking schema compatibility. Disaster recovery remains a
separate operator procedure below.

The digest in `group_vars/all/main.yml` is the bootstrap/recovery baseline, not
an automatic selector for future releases. The active version is recorded on
the server in `/srv/crm/deployed-release` and in the Actions summary. Do not run
`playbooks/deploy.yml` as a routine release; it can restore the older baseline.

### One-time GitHub setup (operator)

Add these **environment secrets** in Settings → Environments → `production`:

| Secret | Value |
| --- | --- |
| `CRM_DEPLOY_HOST` | Production SSH hostname or IPv4, without `https://` or a port |
| `CRM_DEPLOY_SSH_KEY` | Dedicated private SSH key authorized for root on that host |
| `CRM_DEPLOY_KNOWN_HOSTS` | OpenSSH known_hosts entry for that exact hostname/IP, verified through a trusted channel |

Use a dedicated deployment key, never the developer's personal SSH key. The
workflow uses port 22, strict host-key verification and root for the existing
Docker/systemd maintenance commands. Do not paste secrets into release notes or
workflow files. It does not need application passwords or an Ansible vault key;
the existing server configuration is retained. GHCR pulls use the temporary
Actions token with `packages: read`.

**Network prerequisite:** production SSH is restricted to administrator addresses.
The deploy job uses a dedicated self-hosted Linux x86_64 runner labelled
`crm-production-deploy`. Provisioning, registration, the single-IP firewall rule
and the public-repository activation restriction are documented in
[the dedicated runner guide](deploy-runner/README.md). Tests and image builds
remain on GitHub-hosted runners. Adding secrets alone does not bypass the
firewall. A rerun of v1.0.1 retains its old workflow; activate this change through
a new manually published release from main after merging it.

Limit the `production` environment to release tags `v*` and protect these tags
from updates/deletion with a repository ruleset. Only authorized maintainers
should be able to publish releases. Workflow validation also rejects malformed
versions, draft/prerelease and commits that have not reached main.

Before the first release, complete the SSH/network setup. No release or
production deployment is performed as part of configuring these workflows.

## Access and credentials

The initial owner is `ceo@lauto.com.ua` (super administrator + LAUTO owner).
Initial password: local `infra/.secrets/ceo-login.json`, mode 0600, never in Git.
Change it after first login. Public registration is disabled; use team invitations.
The account has not been marked email-verified without verification.

Application secrets are encrypted in local `ansible/group_vars/all/vault.yml`.
Vault password, Restic password, backup SSH key and initial login are under
`infra/.secrets/`. Keep a separate secure copy of this directory and `.env`:
losing the Restic password makes the encrypted backups unrecoverable.
Terraform state contains the Storage Box password; protect and back it up too.

The SSH host key was recorded on the first connection to the newly allocated IP
in `infra/.ansible/known_hosts`. Keep it; do not disable host-key checking.

## Backups

`crm-backup.timer` runs hourly. The application and background jobs pause while
a PostgreSQL custom-format dump and uploads archive are captured. The app restarts
before transfer to the encrypted remote repository. A recovery set also contains
`.env`, Compose (image digest), Caddyfile, creation time and image metadata.

Retention: 48 hourly, 30 daily, 12 monthly recovery points. Restic forget removes
old snapshot references; space reclamation (`prune`) is a separate maintenance
operation, performed with no other repository operation running.

```sh
systemctl start crm-backup
systemctl status crm-backup.timer crm-backup.service
journalctl -u crm-backup.service -n 50
cat /var/lib/crm-backup/last-success
/usr/local/sbin/crm-restore-check
cat /var/lib/crm-backup/last-restore-check
```

A monthly restore check decrypts the latest remote copy, reads the uploads archive,
restores PostgreSQL into an isolated temporary container without a network, and
verifies the CEO account. It does not start another CRM or send notifications.
Logs: `/var/log/crm-restore-check.log`. Failed systemd jobs require investigation;
there is not yet a configured external channel for backup-failure alerts.

## Recover onto a new empty server

1. Create a replacement VM with Terraform using a separate state/root if the old
   VM still exists. Do not remove `prevent_destroy` to force replacement blindly.
2. Generate the new inventory. Verify/store the replacement SSH host key.
3. Run `bootstrap.yml`, `operations.yml`, then `backups.yml` with the existing
   Storage Box host/user and keys. Do NOT initialize the repository again.
4. Stop the backup timer until recovery is complete.
5. Run `restore.yml -e confirm_empty_server_restore=true` (optionally select a
   `restore_snapshot`). It refuses an existing installation, restores secrets,
   files and the database; it leaves the app stopped.
6. Authenticate to GHCR, confirm the restored image digest, then start Compose.
   Validate sign-in, customer/work-order data, files and generated documents.
7. Point DNS to the replacement, confirm HTTPS and enable `crm-backup.timer`.
   Disable the old app/jobs before making the replacement authoritative.

The full empty-server playbook needs a separate disaster-recovery rehearsal;
the automated restore check covers decrypting the remote backup and restoring data.

## Monitoring and scaling

GitHub Actions checks public HTTPS and `/api/v1/health` every 15 minutes; GitHub
schedule timing is best-effort. Configure GitHub workflow-failure notifications.
No SMTP/SMS provider has been configured in CRM, so outbound messages and password
reset delivery need provider credentials before use.

Check `df -h`, `free -h`, `docker stats --no-stream`, and backup age. Plan storage
expansion at ~70–75% disk usage. Backups need local temporary disk space too.
For a changed administrator IP, update `admin_cidrs` and apply Terraform using the
Hetzner API. SSH access is not needed for that update.

For CPU/RAM growth, change `server_type`, review the plan, make a backup, and
schedule downtime. `keep_disk=true` retains disk size for later downsizing.
