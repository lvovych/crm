# ARM migration staging

This isolated root created CAX21 `171901270` in `nbg1` for the 2026-10-22
migration. Do not apply it after handover: the replacement is transferred to
`../` production state when validated. Local state, plans and inventories are
private and ignored. This root is retained as the reproducible staging recipe.

1. Create an empty Debian 13 CAX21 in the production location.
2. Bootstrap, configure operations and backups with `backup_timer_enabled=false`.
3. Stop writers on the source with `migration-source.yml` and record the exact
   Restic snapshot ID. Preserve source until validation completes.
4. Restore with `restore.yml`, selecting the exact snapshot. On architecture
   changes set `restore_use_current_images=true` after validating ARM images.
5. Compare row fingerprints for every table and file hashes before app startup.
6. Stage the original IPv6 using `migration-network.yml`; IPv4 uses DHCP.
7. Start/test ARM application locally, then stop it before IP cutover.
8. `migration-cutover.yml` shuts down both servers and reassigns production IPs.
   It requires `confirm_verified_cutover=true` and the temporary IP IDs.
9. Move the replacement into production Terraform state, reconcile configuration,
   verify HTTPS/auth/PDF and take/restore-check a new backup before retirement.

The cutover playbook is deliberately one-shot. If interrupted, read actual server
and IP state through Hetzner API before resuming individual steps. Never retry the
whole play blindly after an IP action. The source remains powered off; do not
start both writers. Rollback assigns original IPs back to the source and restores
its original network configuration. After writes on the new server, copy a fresh
logical recovery set back first; simply powering the old machine on loses writes.
