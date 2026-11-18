# Read-only financial reconciliation

Run against a restored snapshot first:

```sh
DATABASE_URL=... npm run finance:reconcile -- --organization ORG_ID --output report.json
```

The command opens a PostgreSQL REPEATABLE READ, READ ONLY transaction, reads scoped pages of 200 rows, and never repairs data. The default scan limit is 10,000 records per category; `truncated` explicitly identifies incomplete categories. Use `--limit N` to change the cap (up to one million). The transaction has a two-minute timeout; for larger installations run on a snapshot and split the audit operationally.

Checks: printed invoice arithmetic and line/subtotal differences; posted cash-account legs and linked payment amounts; supplier return amounts and received-versus-returned/consumed quantities. Output contains record identifiers and amounts, not customer names or contact details. Treat it as financial data.

`line-subtotal-review` is a review item, not proof of corruption: historical records or recurring base charges may legitimately carry a separate subtotal component. No historic totals are recalculated. Review all findings before proposing a corrective migration.
