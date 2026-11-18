# Financial reliability refactoring

Base: `334e7f2bcad6d24b1de093aa8b12ab8c6619e02f` (main). The [baseline](baseline.md) was committed before application changes.

## Completed scope

1. Make PostgreSQL financial checks mandatory in CI, including payroll and recurring billing; reject missing test database configuration.
2. Share recurring invoice execution and printed line totals between cron and manual processing. Lock each template, re-read the observed due date, and commit the invoice and schedule together. Stale retries do not bill a second overdue period.
3. Reserve automatic invoice numbers in the creating transaction across drafts, normal invoices, quote conversion, recurring invoices and supported imports. Bootstrap a per-organization counter from historical suffixes, honor start/prefix settings, and skip occupied numbers.
4. Share exact bigint parsing, formatting and scaled rounding behind existing money adapters. Preserve the distinct historical `roundMoney` and `roundAsPrinted` contracts.
5. Separate payroll arithmetic from database loading. Add invariants for rounding, half-month conservation, employment boundaries, returns, taxes, recurring totals and concurrent writes.
6. Share report scheduling and replace repeated work-order line scans with stable maps and queues, including duplicate legacy rows.
7. Aggregate historical cash balances and customer ledger summaries in PostgreSQL. Fetch document history only on expansion, in pages of 50, with retry and organization/permission checks.
8. Load employee balances without payslip JSON; page payroll documents by 50 and bound selected employee detail to a date period (90 days by default). All-time balances remain independent of the displayed period.
9. Enforce per-file coverage floors for financial arithmetic in CI.
10. Add a read-only [reconciliation command](reconciliation.md) and a reproducible local benchmark (`scripts/benchmark-financial-refactor.ts`).

## Deployment and compatibility

Apply migrations and regenerate Prisma before starting the new application. Migration `20261119100000_invoice_counter` adds one operational table; it does not rewrite historical invoices, amounts, payments or payroll. The first reservation initializes each organization lazily. All application instances that create automatic numbers must run the new allocator; do not leave old writers running alongside the new deployment.

Historical duplicate numbers are retained. This change serializes automatic allocation; it does not impose a new unique constraint on imported or manually edited historical numbers. Rollback to the old application can leave the additional table in place, but forfeits the new allocation protection.

Application-level backups omit the operational counter: restoring into a new installation bootstraps it from invoices; restoring into an existing organization retains its monotonic counter. PostgreSQL backups preserve it normally.

Reconciliation reports require review. Historical line/subtotal differences can be legitimate; the command never repairs data. No production data was read or changed during this work.
