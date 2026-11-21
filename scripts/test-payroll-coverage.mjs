import { spawnSync } from 'node:child_process'
const value = process.env.FINANCE_TEST_DATABASE_URL
if (!value) throw new Error('FINANCE_TEST_DATABASE_URL is required: payroll integration tests must not skip.')
const url = new URL(value)
if (!['localhost', '127.0.0.1'].includes(url.hostname) || !url.pathname.endsWith('_test'))
  throw new Error('Dedicated local *_test database required')
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.payroll.config.ts', '--coverage', ...process.argv.slice(2)], { stdio: 'inherit', env: process.env })
if (result.error) throw result.error
process.exit(result.status ?? 1)
