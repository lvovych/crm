import { directory, saveEmployee } from '@/features/employees/actions'
import { settlementData } from '@/features/payroll/settlements'
import { cents, decimal } from '@/features/finance/money'
import { UserRound } from 'lucide-react'
import { roles, RoleFields } from '@/features/employees/RoleFields'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function Employees({ searchParams }: { searchParams: Promise<{ tab?: string; employee?: string }> }) {
  const result = await directory()
  if (!result.data) return <p>{result.error}</p>
  const query = await searchParams
  if (query.employee) redirect('/employees/' + encodeURIComponent(query.employee))
  const payroll = result.data.canSeePayroll ? await settlementData() : null
  if (payroll && !payroll.data) return <p role="alert">{payroll.error}</p>
  const docs = query.tab === 'documents' && !!payroll
  const slips = (payroll?.data?.people ?? []).flatMap(p => p.paySlips.map(s => ({ ...s, employee: p })))
    .sort((a,b) => b.createdAt.getTime() - a.createdAt.getTime())
  const button = 'inline-flex rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground'
  const tabClass = (active: boolean) => 'border-b-2 px-3 py-3 font-medium ' + (active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground')
  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 p-6">
      <Link href="/directories" className="text-sm underline">Довідники</Link>
      <h1 className="flex items-center gap-3 text-3xl font-semibold"><UserRound aria-hidden="true" />Працівники</h1>
      <nav className="flex border-b"><Link className={tabClass(!docs)} href="/employees">Список працівників</Link>
        {payroll && <Link className={tabClass(docs)} href="/employees?tab=documents">Документи нарахування</Link>}</nav>
      {docs ? <>
        <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-semibold">Документи нарахування</h2>
        <Link className={button} href="/payroll?mode=new">Створити документ</Link></div>
        <div className="overflow-x-auto rounded-lg border"><table className="w-full text-left text-sm tabular-nums">
          <thead className="bg-muted"><tr>{['Працівник','Період','Статус','Нараховано'].map(h => <th className="p-3 last:text-right" key={h}>{h}</th>)}</tr></thead>
          <tbody>{slips.map(s => <tr key={s.id} className="border-t hover:bg-muted/40">
            <td className="p-3"><Link className="font-medium underline" href={'/payroll?employee='+s.employee.id+'&slip='+s.id}>{s.employee.name}</Link></td>
            <td className="p-3">{s.start.toLocaleDateString('uk-UA',{timeZone:'UTC'})} — {s.end.toLocaleDateString('uk-UA',{timeZone:'UTC'})}</td>
            <td className="p-3">{s.status === 'new' ? 'Новий' : 'Завершено'}</td>
            <td className="p-3 text-right font-semibold">{s.total.toFixed(2).replace('.',',')} грн</td></tr>)}</tbody></table>
          {!slips.length && <p className="p-4">Проведених документів ще немає.</p>}</div>
      </> : <>
      {result.data?.canManage && (
        <details className="rounded border p-4">
          <summary>Додати працівника</summary>
          <form action={saveEmployee} className="mt-4 space-y-3">
            <input
              className="rounded border p-2"
              name="name"
              aria-label="Ім’я"
              placeholder="Ім’я та прізвище"
              required
            />
            <RoleFields selected={['mechanic']} />
            <button>Створити</button>
          </form>
        </details>
      )}
      <div className="overflow-hidden rounded-lg border"><table className="w-full text-sm">
        <thead className="bg-muted"><tr><th className="p-3 text-left">Ім’я</th><th className="p-3 text-right">{payroll ? 'До виплати' : 'Робочі ролі'}</th></tr></thead>
        <tbody>{result.data.people.map(p => {
          const account = payroll?.data?.people.find(person => person.id === p.id)
          const earned = account?.paySlips.filter(s => s.status === 'completed').reduce((sum,s) => sum + cents(s.total.toFixed(2)), BigInt(0)) ?? BigInt(0)
          const balance = account?.staffPayments.reduce((sum,payment) => payment.document.reversal ? sum : sum - cents(payment.document.amount.toFixed(2)), earned) ?? earned
          return <tr className="border-t hover:bg-muted/40" key={p.id}><td className="p-3"><Link className="font-medium underline" href={'/employees/'+encodeURIComponent(p.id)}>{p.name}</Link>{p.dismissedOn && ' · Звільнено'}</td>
            <td className="p-3 text-right font-semibold tabular-nums">{account ? decimal(balance).replace('.',',')+' грн' : p.workRoles.map(r => roles[r as keyof typeof roles]).join(', ')}</td></tr>
        })}</tbody></table></div>

      </>}
    </main>
  )
}
