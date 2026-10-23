import { defineConfig, mergeConfig } from 'vitest/config'
import base from './vitest.config'
export default mergeConfig(
  base,
  defineConfig({
    test: {
      environment: 'node',
      include: [
        'src/__tests__/features/stock-ledger/*.test.ts',
        'src/__tests__/features/inventory/reconcile-stock.test.ts',
        'src/__tests__/features/quotes/convert-quote-inventory.test.ts',
        'src/__tests__/features/invoices/recurring-invoice-timezone.test.ts',
        'src/__tests__/features/workorders/save-service-lines.test.ts',
      ],
      coverage: {
        provider: 'v8',
        include: ['src/features/stock-ledger/Lib/*.ts'],
        reportsDirectory: './test-results/stock-ledger-coverage',
        reporter: ['text', 'json-summary', 'html'],
        thresholds: {
          lines: 88,
          statements: 85,
          functions: 90,
          branches: 70,
          'src/features/stock-ledger/Lib/amounts.ts': {
            lines: 100,
            functions: 100,
            branches: 100,
            statements: 100,
          },
        },
      },
    },
  })
)
