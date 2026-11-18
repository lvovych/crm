import { readFileSync } from 'node:fs'
const report = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'))
const gates = {
  'src/lib/money.ts': [100, 100, 100, 100],
  'src/lib/exact-money.ts': [100, 100, 100, 100],
  'src/features/finance/money.ts': [90, 95, 100, 90],
  'src/lib/tax.ts': [98, 94, 100, 100],
  'src/features/receipts/money.ts': [100, 100, 100, 100],
  'src/features/receipts/return-money.ts': [92, 88, 100, 100],
  'src/features/settlements/amounts.ts': [100, 94, 100, 100],
  'src/features/payroll/calculator.ts': [97, 91, 100, 100],
  'src/features/billing/Lib/recurringTotals.ts': [100, 90, 100, 100],
}
let failed = false
for (const [file, minimum] of Object.entries(gates)) {
  const found = Object.entries(report).find(([name]) =>
    name.replaceAll('\\', '/').endsWith('/' + file)
  )?.[1]
  for (const [i, metric] of ['statements', 'branches', 'functions', 'lines'].entries()) {
    if (!found || found[metric].pct < minimum[i]) {
      console.error(`${file} ${metric}: ${found?.[metric]?.pct ?? 'missing'} < ${minimum[i]}`)
      failed = true
    }
  }
}
if (failed) process.exit(1)
console.log('Financial coverage gates passed')
