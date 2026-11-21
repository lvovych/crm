# Period payroll documents

The owner opens **Salary**, configures independent percentage rules for each employee, and creates one document for one employee and an inclusive local-date period. Only orders with `status = completed` and `payrollEarnedAt` inside that period are eligible. The document date, payment date and service date do not select orders.

Rules are append-only versions effective on the order's closure date. Mechanics earn on their own work. A manager can select all workshop orders, assigned orders, or the appropriate parts-seller scope. Net work income may deduct the mechanic's percentage and subcontract costs. Missing mechanic rules or missing parts cost block a calculation that would otherwise overstate net income.

The line's explicit mechanic ID takes priority. Otherwise closed lines resolve the frozen executor name against the same workshop's unique employee identity; unfrozen lines inherit the order mechanic. Ambiguous frozen names are reported, never guessed from the current header or order creator. Subcontract work and shop fees do not earn a mechanic commission.

**Team** accounts control access; linked **Employees** cards control work assignments and payroll. Active cards appear first and by default. Archived cards remain available explicitly, preserving historic references and balances. Account roles distinguish existing manager cards from the old default mechanic label without creating duplicate people.

Draft previews and saves use revision checks. Posting recalculates and rejects stale documents, overlapping employee periods and already-paid orders. PostgreSQL protects posted v2 snapshots and rule versions against updates or deletion. Payout allocation uses the existing employee settlement ledger. Existing documents remain readable; legacy percentage plans are supported, but monthly salary is not included in the new percentage calculation.

## Quick periods and manual adjustments

The optional period preset fills inclusive calendar dates using the workshop's current local day. Weeks start Monday and end Sunday. “Current two weeks” means the previous and current week. Editing either date restores manual mode; choosing manual mode preserves the dates.

A draft can contain named bonuses (+) and deductions (−), each with a positive amount and required explanation. These are part of the v2 document snapshot, preview fingerprint and optimistic revision. Recalculation rebuilds order commissions and adds manual rows once. Posting verifies both; immutable posted snapshots preserve the explanations. Adjustment-only documents do not require commission rules. Negative net totals remain signed in the existing employee balance. Existing documents without adjustments retain their fingerprints. No database migration is required.

## Paying a posted document

“Провести виплату” loads available cash accounts, the unpaid balance and the salary expense category. The amount remains editable for partial payments. The server checks payroll/finance permissions, account access, operation date, cash balance and the document's outstanding balance. It creates a cash expense through the existing ledger and allocates it to this specific salary document in one transaction. The shared finance lock prevents concurrent overpayment; the request ID makes retries idempotent. An existing salary category is reused, or “Зарплати” is created during the first successful payment. Merely opening the dialog does not create financial records.

## Validation

Use a dedicated local database ending in `_test`; never point these commands at a review copy or production.

```sh
DATABASE_URL="$FINANCE_TEST_DATABASE_URL" npx prisma migrate deploy
npm run test:payroll:coverage
npm run test:finance
npm run test:coverage -- --maxWorkers=2
npm run test:coverage:check
npm run lint
npm run build
```

`test:payroll:coverage` requires `FINANCE_TEST_DATABASE_URL` and fails rather than skipping PostgreSQL tests. All new payroll/roster modules, including the three interactive UI components, must exceed 90% on statements, branches, functions and lines **per file**. Reports are under `coverage/payroll`. Existing financial coverage requirements remain independent.

The Playwright `payroll/period-documents.spec.ts` checks desktop/mobile rule configuration, frozen inherited executors, date/status exclusion, save/post flow, totals and immutable UI on the production build. `settlement-pagination.spec.ts` checks existing balances and document history. The E2E harness owns and resets only its separate `E2E_DATABASE_URL`.

## Release

Follow `infra/RUNBOOK.md`: merge tested changes into main, publish a new stable release, wait for the release workflow. It backs up PostgreSQL and uploads before deploying. The release now gates image creation on financial PostgreSQL tests and the payroll per-file coverage threshold. After deployment, verify the recorded release, migrations, container health, public health/sign-in and authenticated read-only payroll/employee pages. Do not create sample salary documents in production.
