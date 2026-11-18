# Local performance measurements

Measured on 2026-11-18, macOS x64, Node 22.23.5, dedicated PostgreSQL 16, against baseline `334e7f2bcad6d24b1de093aa8b12ab8c6619e02f`. One warm-up and five samples; table shows median elapsed milliseconds, serialized result bytes, and database query count. Tests/build were not running during the measurement.

| Scenario | Median ms, before → after | Result bytes, before → after | Queries, before → after |
|---|---:|---:|---:|
| Work-order matching: 500 lines | 5.224 → 1.764 | 90,671 → 90,671 | 0 → 0 |
| Work-order matching: 2,000 lines | 49.126 → 5.866 | 366,671 → 366,671 | 0 → 0 |
| 200 documents / 20,000 ledger events | 284.737 → 49.908 | 11,105,291 → 78,091 | 2 → 1 |
| 100 employees / 5,200 payslips | 229.809 → 6.907 | 4,891,691 → 7,691 | 6 → 1 |
| 100,000 synthetic cash movements | 231.013 → 46.364 | 5,200,001 → 11,131 | 1 → 1 |

Line matching loads the original implementation with `git show` and uses the same mocked read result for both implementations; zero queries means no real database work for that case. The customer and employee cases compare the former Prisma relation reads with the new summary reads on identical fixtures. These measure data retrieval/serialization, not browser rendering or full endpoint latency. Customer projection equivalence is checked separately by PostgreSQL integration tests.

The cash case uses a synthetic PostgreSQL `generate_series` relation, not a production table or execution plan. It demonstrates aggregation and transport cost only. These are local observations, not promised production speedups or CI thresholds. Production-sized execution plans and end-to-end latency should be measured on a restored snapshot before further indexing changes.

Reproduce with an isolated local `*_test` database after migrations:

```sh
FINANCE_TEST_DATABASE_URL=postgresql://.../finance_test npx tsx scripts/benchmark-financial-refactor.ts
```

The benchmark creates its own organization and fixture data in that disposable database; it does not delete unrelated records. The original implementation is loaded from the fixed base commit, so that commit must be available locally.
