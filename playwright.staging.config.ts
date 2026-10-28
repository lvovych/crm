import { defineConfig } from '@playwright/test'

const baseURL = process.env.STAGING_BASE_URL ?? 'http://localhost:55440'
const target = new URL(baseURL)
if (!['localhost', '127.0.0.1'].includes(target.hostname) || !['55440', '3097'].includes(target.port)) {
  throw new Error('Auth staging tests require isolated local auth (55440) or ledger (3097) staging')
}
export default defineConfig({
  testDir: './e2e/staging',
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['json', { outputFile: 'test-results/auth-staging/results.json' }]],
  outputDir: 'test-results/auth-staging/artifacts',
  use: { baseURL, locale: 'en-US', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
})
