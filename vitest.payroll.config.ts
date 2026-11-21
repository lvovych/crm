import { defineConfig, mergeConfig } from 'vitest/config'
import base from './vitest.config'
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ['src/__tests__/features/payroll/**/*.test.{ts,tsx}'],
      maxWorkers: 2,
      coverage: {
        provider: 'v8',
        reportsDirectory: 'coverage/payroll',
        reporter: ['text', 'json', 'json-summary', 'html'],
        include: [
          'src/features/payroll/commission-{calculator,rules}.ts',
          'src/features/payroll/document-{actions,calculation}.ts',
          'src/features/payroll/participants.ts',
          'src/features/payroll/{adjustments,period-presets}.ts',
          'src/features/payroll/{AdjustmentFields,SalaryPayment}.tsx',
          'src/features/payroll/salary-payments.ts',
          'src/features/employees/roster.ts',
          'src/features/payroll/{CommissionLines,IndividualRules,PayrollWorkspace}.tsx',
        ],
        thresholds: { perFile: true, statements: 91, branches: 91, functions: 91, lines: 91 },
      },
    },
  })
)
