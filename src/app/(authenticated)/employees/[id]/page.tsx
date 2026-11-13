import Link from 'next/link'
import { notFound } from 'next/navigation'
import { directory, saveEmployee, dismissEmployee } from '@/features/employees/actions'
import { roles, RoleFields } from '@/features/employees/RoleFields'

export default async function EmployeeCard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await directory()
  if (!result.data) return <p role="alert">{result.error}</p>
  const selected = result.data.people.find(person => person.id === id)
  if (!selected) notFound()
  return (
    <main className="mx-auto w-full max-w-3xl space-y-5 p-6">
      <Link href="/employees" className="text-sm underline">← До списку працівників</Link>
      <article className="space-y-4 rounded-lg border p-5">
        <h1 className="text-xl font-semibold">{selected.name}</h1>
        <p>{selected.workRoles.map(r => roles[r as keyof typeof roles]).join(', ')} · {selected.userId ? 'Прив’язано користувача CRM' : 'Без облікового запису'}</p>
        {result.data.canSeePayroll && <div className="flex flex-wrap gap-3"><Link className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground" href={'/payroll?mode=rules&employee='+selected.id}>Правила нарахування</Link>
        <Link className="rounded-md border px-4 py-2 text-sm font-medium" href={'/employee-settlements?employee='+selected.id}>Листки та виплати</Link></div>}
          {result.data?.canManage && !selected.dismissedOn && (
            <details className="mt-2">
              <summary>Редагувати</summary>
              <form action={saveEmployee} className="my-3 space-y-2">
                <input type="hidden" name="id" value={selected.id} />
                <input className="rounded border p-2" name="name" defaultValue={selected.name} required />
                <RoleFields selected={selected.workRoles} />
                <button>Зберегти</button>
              </form>
              <form action={dismissEmployee}>
                <input type="hidden" name="id" value={selected.id} />
                <button>Звільнити сьогодні</button>
              </form>
            </details>
          )}
        </article>
    </main>
  )
}
