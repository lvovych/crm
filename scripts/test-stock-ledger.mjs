import { spawnSync } from 'node:child_process'
const url = process.env.LEDGER_TEST_DATABASE_URL
if (!url || !/^postgresql:\/\/[^@]+@(?:127\.0\.0\.1|localhost):\d+\/crm_ledger_test(?:\?|$)/.test(url)) {
  console.error('Set LEDGER_TEST_DATABASE_URL to an isolated local crm_ledger_test database. Refusing skipped database tests or a production connection.')
  process.exit(1)
}
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.ledger.config.ts', ...process.argv.slice(2)], { stdio: 'inherit', env: process.env })
if (result.error) console.error(result.error.message)
process.exit(result.status ?? 1)
