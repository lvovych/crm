# Brands

The migration seeds 347 workshop-supplied names plus the protected `brand_unknown` / `---` record. Names are unique after trimming spaces and lowercasing. The directory is global, with authenticated read access and no CRUD UI.

Products reference `brands.id`. To retire a brand, set `isActive = false` through SQL; existing references remain readable. Referenced brands cannot be deleted. The `updatedAt` trigger applies to SQL edits too. Renaming a brand does not rewrite the name snapshots in service, quote or preset lines.

## Restore historical Carbook brands

1. Take an application/database backup and verify it succeeded.
2. Deploy the migration and application together.
3. Prepare from the existing private export (no API download):
   `python3 infra/scripts/brands/prepare_restore.py --archive infra/.secrets/carbook`
4. Review the counts and execute the generated private `brands-restore.sql` with `psql -v ON_ERROR_STOP=1` against the intended CRM database.
5. Verify a historical order and its completion-act PDF.

The generated transaction locks the relevant tables briefly, checks organization and original line identity, refuses conflicting brands, and changes **only** `service_parts.brand`. It compares all other part columns and every order/payment column before and after, aborting if anything differs. Repeating it is safe. Manual spreadsheet imports and newly created orders are excluded by source IDs. Original historical brand spelling is preserved even when absent from the supplied directory; missing names become `---`.

`check_migration.sql` tests the schema/seed/constraints in an isolated schema and rolls everything back. Run with local psql from any directory; the migration is loaded relative to this script. Never run concurrently with another copy of this test.
