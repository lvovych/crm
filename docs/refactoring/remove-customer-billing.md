# Retire the customer invoice register and recurring invoices

User-requested follow-up to the local review. Customer balances and their document detail are already available through mutual settlements and customer cards.

Removed the desktop/mobile navigation entry, invoice register UI/query, recurring invoice UI/actions/calculation/scheduler and cron registration. Both legacy URLs redirect to `/mutual-settlements`. Ordinary work orders, invoices/PDFs, customer payments, payment permissions and settlement history remain supported. The retained `billing` permission identifier is labelled Customer payments to preserve existing role grants.

Removed recurring templates from backup export/import and the AI query schema. Old backups cannot reintroduce the automation. The migration `20261119110000_retire_recurring_invoices` drops the three recurring-template tables; deploy it with this application version and regenerate Prisma. Historical audit translations remain readable. Tests and the coverage entry specific to the deleted calculator were removed; all other financial coverage thresholds remain unchanged.

## Local data audit

Before migration, `crm_refactor_review` on `127.0.0.1:55433` contained **zero recurring templates** and **111 service records**. There were no recurring-action audit rows. The former generator did not store a recurring-template ID on generated service records, so there is no reliable provenance filter for deleting generated records after their template is gone. No service record was identified conclusively as automatic and none was deleted by inference. Ordinary records must not be deleted simply because they used to appear in the removed register.

A dump of the three retired local tables was saved outside the repository before applying the migration. No production database was accessed. If specific historical generated service records are to be removed, their IDs must be identified separately; this migration deliberately does not guess from titles or dates.

## Verification

- Prisma client generation and local migration passed.
- 239 financial tests passed against the dedicated `finance_test` database.
- 255 permission/localization tests passed; backup and AI-schema focused tests also passed.
- Lint passed for 2,092 files. TypeScript passed before production build.
- Local logs: `/tmp/crm-remove-billing-*.log`.

Final production build (including TypeScript) passed. After restart, browser checks confirmed both legacy redirects, absence of billing navigation on desktop/mobile, and HTTP 200 for customers, work orders, finance and mutual settlements with no page errors. The local database still contains 111 service records and none of the three retired tables.
