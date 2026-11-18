import { spawnSync } from 'node:child_process'
const url = process.env.FINANCE_TEST_DATABASE_URL
if (!url)
  throw new Error(
    'FINANCE_TEST_DATABASE_URL is required; financial integration tests must not skip.'
  )
const parsed = new URL(url)
if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
  throw new Error('Dedicated local *_test database required')
const result = spawnSync(
  process.execPath,
  [
    'node_modules/vitest/vitest.mjs',
    'run',
    'src/__tests__/features/finance',
    'src/__tests__/features/customer-ledger',
    'src/__tests__/features/documents',
    'src/__tests__/features/payroll',
    '--maxWorkers=2',
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit', env: process.env }
)
if (result.error) throw result.error
process.exit(result.status ?? 1)
