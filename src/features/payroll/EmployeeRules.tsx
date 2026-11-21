import Link from 'next/link'
import type { payrollData } from './actions'
export function EmployeeRules({
  data,
}: {
  data: NonNullable<Awaited<ReturnType<typeof payrollData>>['data']>
}) {
  if (!data.employee) return null
  return (
    <section className="space-y-3 rounded-lg border p-5">
      <h2 className="text-lg font-semibold">Індивідуальні правила зарплати</h2>
      <p className="text-sm text-muted-foreground">
        Відсотки за роботи та запчастини, дати дії й історія змін.
      </p>
      <Link
        className="inline-flex rounded-lg border px-4 py-2 text-sm"
        href={`/payroll?mode=rules&employee=${data.employee.id}`}
      >
        Відкрити правила працівника
      </Link>
    </section>
  )
}
