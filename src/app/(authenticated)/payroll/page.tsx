import { payrollWorkspace } from '@/features/payroll/document-actions'
import { PayrollWorkspace } from '@/features/payroll/PayrollWorkspace'

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; employee?: string; slip?: string }>
}) {
  const initial = await searchParams
  const result = await payrollWorkspace(initial.slip)
  if (!result.data)
    return (
      <p role="alert" className="p-6">
        {result.error}
      </p>
    )
  return <PayrollWorkspace data={result.data} initial={initial} />
}
