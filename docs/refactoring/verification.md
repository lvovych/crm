# Financial-refactor verification snapshot

This records the financial-refactor milestone before the later localization and removal of recurring billing. It is not the final release gate. See [localization](localization.md), [billing removal](remove-customer-billing.md), and the final PR checks for subsequent verification.

2026-11-18; same isolated worktree and Node/PostgreSQL environment as the [pre-change baseline](baseline.md). Latest `origin/main` was checked again and remains `334e7f2bcad6d24b1de093aa8b12ab8c6619e02f`.

| Check | Final result |
|---|---|
| Migrations | Passed on financial test DB and fresh E2E DB |
| Lint | Passed, 2,100 files |
| TypeScript (`tsc --noEmit`) | Passed |
| Production build | Passed after final application changes |
| Financial PostgreSQL suite | 27 files, 254 tests passed, 22.50 seconds |
| Targeted Chromium E2E | 17 passed, 2.9 minutes, including setup |
| Financial coverage floors | All passed |

Full coverage run:

```text
Test Files  411 passed | 8 skipped (419)
Tests  5283 passed | 104 skipped (5387)
Duration  300.44s (transform 10.72s, setup 44.51s, import 76.59s, tests 76.61s, environment 281.02s)
```

Overall coverage: statements 66.21%, branches 58.36%, functions 62.38%, lines 67.60%. Baseline: 66.00%, 58.17%, 62.20%, 67.39%. Instrumented-source sets differ after extraction, so these percentages alone are not a quality score. The default run skips DB-dependent tests; the separate financial run above executes the financial integrations with a real database. Eight default-run files / 104 tests remain skipped; this is not a claim that every repository test executes in that run.

| Financial module | Statements % | Branches % | Functions % | Lines % |
|---|---:|---:|---:|---:|
| `src/lib/money.ts` | 100 | 100 | 100 | 100 |
| `src/lib/exact-money.ts` | 100 | 100 | 100 | 100 |
| `src/features/finance/money.ts` | 90.9 | 100 | 100 | 90 |
| `src/lib/tax.ts` | 98.24 | 94.44 | 100 | 100 |
| `src/features/receipts/money.ts` | 100 | 100 | 100 | 100 |
| `src/features/receipts/return-money.ts` | 100 | 100 | 100 | 100 |
| `src/features/settlements/amounts.ts` | 100 | 100 | 100 | 100 |
| `src/features/payroll/calculator.ts` | 98.57 | 93.5 | 100 | 100 |
| `src/features/billing/Lib/recurringTotals.ts` | 100 | 100 | 100 | 100 |

E2E covered automatic numbering; tax-inclusive/exclusive pricing and discounts; cash draft/posting/transfer/reversal; customer history on desktop/mobile; payroll pagination, period filtering and unchanged all-time balance. The full browser suite and cloud-only scenarios were not run locally.

Reconciliation smoke test scanned four invoices, ten cash postings and two receipt lines in an isolated integration-test organization, without truncation. It reported four expected printed-total mismatches in intentionally incomplete test invoice fixtures; no posting or receipt findings. This validates the reporting path, not the correctness of production data.

Intermediate failures were resolved before these results: action mocks were updated for transactional numbering, three uncovered financial branches received tests without lowering gates, and the new lazy-history UI test stopped dispatching a duplicate synthetic toggle event. Prisma initially blocked E2E database reset; the user explicitly authorized clearing the dedicated `crm_refactor_e2e` database, after which E2E passed. Baseline remains the separate pre-change commit.

[Performance measurements and reproduction](performance.md). No production dataset or production latency was measured.

## Local evidence

Raw logs are retained outside the repository at `/Users/lvovych/Projects/CRM/outputs/refactor-baseline`. SHA-256 checksums:

```text
5c36ce001e5fd5f2950dd0dcc101e2c00bd51b4aa5f1a5bb80930a344e629701  full-verified.log
af8ba68e51ecb8f1f5654e2a704eddd27ef16f10b805341dfe2973a1408dcba0  finance-verified.log
40bfcb9c5f0d616de25fd915bcb696c5150dc8cd12cb87fd3f796eb94893802b  e2e-verified.log
8432b63b55065a2d934bcf6690032fdb80795066ae5acedb30f83c48f84217db  build-verified.log
a6d0a1e28a1aae24d0d81a4096cb078b56ab6b96ff46dffe0a4ac961e52b3167  lint-verified.log
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  types-verified.log
e64d82a902f390a7ab328c19b4af6a3d2599df48dbc3064e1290d455bcb17feb  benchmark-verified.json
e529c891b2172e13dafc9ba2a054cb552126104aab55f85b70b43aa9905d7a7d  reconciliation-postings.json
```
