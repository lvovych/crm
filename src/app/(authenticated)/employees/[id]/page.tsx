import { payrollData } from '@/features/payroll/actions'
import { EmployeeRules } from '@/features/payroll/EmployeeRules'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { directory, saveEmployee } from '@/features/employees/actions'
import { roles, RoleFields } from '@/features/employees/RoleFields'

export default async function EmployeeCard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await directory()
  if (!result.data) return <p role="alert">{result.error}</p>
  const selected = result.data.people.find(person => person.id === id)
  if (!selected) notFound()
  const payroll = result.data.canSeePayroll ? await payrollData(id) : null
  const [first, ...rest] = selected.name.split(/\s+/)
  const hired = selected.hiredOn?.toISOString().slice(0, 10) ?? ''
  const dismissed = selected.dismissedOn?.toISOString().slice(0, 10) ?? ''
  return (
    <main className="mx-auto w-full max-w-3xl space-y-5 p-6">
      <Link href="/employees" className="text-sm underline">← До списку працівників</Link>
      <article className="space-y-4 rounded-lg border p-5">
        <h1 className="text-xl font-semibold">{selected.name}</h1>
        <p>{selected.workRoles.map(r => roles[r as keyof typeof roles]).join(', ')} · {selected.userId ? 'Прив’язано користувача CRM' : 'Без облікового запису'}</p>
        {result.data.canManage ? <form action={saveEmployee} className="grid gap-4 sm:grid-cols-2 [&_label>input:not([type=checkbox])]:block [&_label>input:not([type=checkbox])]:w-full [&_input]:rounded [&_input]:border [&_input]:p-2">
          <input type="hidden" name="id" value={id} />
          <label>Ім’я<input required name="givenName" defaultValue={selected.givenName ?? first}/></label>
          <label>Прізвище<input name="familyName" defaultValue={selected.familyName ?? rest.join(' ')}/></label>
          <label>Дата прийому на роботу<input type="date" name="hiredOn" defaultValue={hired}/></label>
          <label>Дата звільнення<input type="date" name="dismissedOn" defaultValue={dismissed}/></label>
          <div className="sm:col-span-2"><RoleFields selected={selected.workRoles}/></div>
          <button className="justify-self-start rounded bg-primary px-4 py-2 text-primary-foreground">Зберегти дані працівника</button>
        </form> : <p>Дата прийому: {hired || '—'} · Дата звільнення: {dismissed || '—'}</p>}
        </article>
      {payroll?.data && <div className="space-y-4 [&_input]:rounded [&_input]:border [&_input]:p-1 [&_button]:rounded [&_button]:border [&_button]:px-3 [&_button]:py-1 [&_summary]:cursor-pointer">
        <EmployeeRules data={payroll.data}/>
        <Link className="underline" href={'/employee-settlements?employee='+id}>Листки та виплати</Link>
        <Link className="ml-4 underline" href={'/payroll?mode=rules&employee='+id}>Призначення в нарядах</Link>
      </div>}
    </main>
  )
}
