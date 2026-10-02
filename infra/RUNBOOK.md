# CRM production operations

## Deployment

- URL: https://crm.srv.lauto.com.ua
- VM: `crm-production`, Debian 13, CPX22, Nuremberg.
- IPv4: `162.55.182.40`; IPv6: `2a01:4f8:c2c:761c::1`.
- Data: `/srv/crm/postgres` and `/srv/crm/uploads` on the system disk.
- Backup: Restic over SFTP to `u681240.your-storagebox.de` (BX11, Helsinki).
- All commands below start from `infra/ansible`, unless stated otherwise.

Application, PostgreSQL and Caddy images are pinned by digest.
Application images are built by `.github/workflows/crm-image.yml`. Release by
updating `crm_image` to the successful build's immutable digest in
`group_vars/all/main.yml`. The application is not automatically upgraded on push.
Keep registry authentication separate from the application secrets. Authenticate
with a read-only GHCR credential before deployment and log out after pulling.
Never place tokens in CLI arguments or Git. The initial deployment uses the
operator's existing GitHub authentication temporarily for the pull.

```sh
ansible-playbook --private-key ~/.ssh/id_rsa playbooks/deploy.yml \
  -e @group_vars/all/vault.yml --vault-password-file ../.secrets/vault-password
```

Before deploying schema changes, run `systemctl start crm-backup` on the server
and confirm success. Do not run deployment concurrently with backup/restore.
Rollback to a previous image only if its schema is compatible; otherwise restore
a matching recovery set. Never run demo seed scripts against production.

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
