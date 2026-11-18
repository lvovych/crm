# Financial reliability refactoring — baseline

Captured before application changes on 2026-11-18 from `334e7f2bcad6d24b1de093aa8b12ab8c6619e02f` (origin/main).
Branch: `refactor/financial-reliability`. Environment: macOS x64, Node 22.23.5, npm 10.9.9, PostgreSQL 16 in a dedicated local container, port 55433, database `finance_test`. Dependencies installed from the unchanged package-lock.json. No production data used.

| Check | Result |
|---|---|
| Prisma generate | Passed |
| All migrations on empty PostgreSQL | Passed |
| npm run lint | Passed, 2076 files |
| Full Vitest with V8 coverage, maxWorkers=2 | 403 files passed, 6 skipped; 5252 tests passed, 97 skipped; 517.21 seconds |
| Financial integration + unit suite with PostgreSQL | 19 files, 231 tests passed; 35.15 seconds |
| npm run build (Turbopack) | Passed, exit 0 |
| Browser E2E | Not run in baseline; targeted E2E required after implementation |

The first concurrent full-test/build attempt was stopped (exit 143) because of resource contention. Its integration run had timeouts (5 files failed, 6 tests failed). The sequential rerun above passed without code changes. These timings are local observations, not CI performance targets.

The default unit run skips database-dependent tests. CI currently supplies FINANCE_TEST_DATABASE_URL only to finance, customer-ledger and documents, omitting payroll. The separate baseline command explicitly includes payroll. No coverage threshold is configured in baseline.

Overall V8 coverage: statements 66%, branches 58.17%, functions 62.20%, lines 67.39%. This is the baseline instrumented-source set, not proof that every source file is covered.

## Reproduction

```sh
npm ci
npx prisma generate
# Point DATABASE_URL and FINANCE_TEST_DATABASE_URL at an isolated local *_test DB.
npx prisma migrate deploy
npm run lint
npm test -- --maxWorkers=2 --coverage --coverage.reporter=json-summary --coverage.reporter=text
npx vitest run src/__tests__/features/finance src/__tests__/features/customer-ledger src/__tests__/features/documents src/__tests__/features/payroll --maxWorkers=2
npm run build
```

## Critical-module coverage

| Module | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| src/features/finance/money.ts | 92.3% | 100% | 100% | 91.66% |
| src/features/payroll/calculation.ts | 97.36% | 91.35% | 100% | 100% |
| src/features/receipts/money.ts | 100% | 100% | 100% | 100% |
| src/features/receipts/return-money.ts | 92.3% | 88.88% | 100% | 100% |
| src/features/settlements/amounts.ts | 100% | 94.28% | 100% | 100% |
| src/lib/money.ts | 100% | 100% | 100% | 100% |
| src/lib/tax.ts | 98.24% | 94.44% | 100% | 100% |

## Evidence

Raw logs are retained locally in `outputs/refactor-baseline/` outside the worktree. SHA-256 hashes:

- `generate.log`: `7d7c95a38c2b5eaea8c271be5c3a54b05756b10270000abd7f5dd8aa03072204`
- `migrations.log`: `f971e5371d0416c8d7be43b4d5730710665232ddbbbe2c749a2a23061562a20b`
- `lint.log`: `d566657006ffb9054c523a5fb6c68ce0d2f6eeaf98f3a958eaad63d86b1f773a`
- `unit-isolated.log`: `b16fe2476702d885ef1ad70f9b2bcf94726fd6644f9bb94374b61c9ebeefa09b`
- `integration-isolated.log`: `7deb6a95914ca32d9aa483e78ca40ea9ff8dbd3dcf705d4487776f6362189fc8`
- `build-isolated.log`: `44e31c62fb17f232f18af6ab7406c106fe4395605afdb8a1eb1c1ead076a252a`
- `coverage/coverage-summary.json`: `f73b713e9c3c5cce57978ca5bdc59af1ac8ce88f41c23acf94db68d32b2d99db`

## Implementation order

1. Make payroll PostgreSQL checks mandatory in CI.
2. Rounded recurring-invoice lines and totals.
3. Idempotent recurring execution.
4. Shared transactional invoice numbering.
5. Exact money primitives with legacy adapters.
6. Pure payroll calculator.
7. Financial invariants and concurrency coverage.
8. Shared manual/background services and scheduling helpers.
9. Critical coverage gates.
10. Historical balance, settlement reads and line matching performance, with measurements.
11. Read-only reconciliation tool.

Items 2–4 and 8 share the recurring-invoice service and are implemented together. Existing historical amounts and payroll plan semantics must remain unchanged.
