import { directory, saveEmployee } from '@/features/employees/actions'
import { settlementData, payrollDocuments } from '@/features/payroll/settlements'
import { cents, decimal } from '@/features/finance/money'
import { UserRound } from 'lucide-react'
import { roles, RoleFields } from '@/features/employees/RoleFields'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function Employees({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; employee?: string; page?: string }>
}) {
  const result = await directory()
  if (!result.data) return <p>{result.error}</p>
  const query = await searchParams
  if (query.employee) redirect('/employees/' + encodeURIComponent(query.employee))
  const payroll = result.data.canSeePayroll ? await settlementData() : null
  if (payroll && !payroll.data) return <p role="alert">{payroll.error}</p>
  const docs = query.tab === 'documents' && !!payroll
  const documents = docs ? await payrollDocuments(Math.max(1, Number(query.page) || 1)) : null
  if (documents && !documents.data) return <p role="alert">{documents.error}</p>
  const slips = (documents?.data?.rows ?? []).map((s) => ({ ...s, employee: s.technician }))
  const button =
    'inline-flex rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground'
  const tabClass = (active: boolean) =>
    'border-b-2 px-3 py-3 font-medium ' +
    (active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground')
  return (
    <main className="ops-workspace mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
      <Link href="/directories" className="text-sm underline">
        Довідники
      </Link>
      <h1 className="flex items-center gap-3 text-3xl font-semibold">
        <UserRound aria-hidden="true" />
        Працівники
      </h1>
      <nav className="flex border-b">
        <Link className={tabClass(!docs)} href="/employees">
          Список працівників
        </Link>
        {payroll && (
          <Link className={tabClass(docs)} href="/employees?tab=documents">
            Документи нарахування
          </Link>
        )}
      </nav>
      {docs ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Документи нарахування</h2>
            <Link className={button} href="/payroll?mode=new">
              Створити документ
            </Link>
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-sm tabular-nums">
              <thead className="bg-muted">
                <tr>
                  {['Працівник', 'Період', 'Статус', 'Нараховано'].map((h) => (
                    <th className="p-3 last:text-right" key={h}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slips.map((s) => (
                  <tr key={s.id} className="border-t hover:bg-muted/40">
                    <td className="p-3">
                      <Link
                        className="font-medium underline"
                        href={'/payroll?employee=' + s.employee.id + '&slip=' + s.id}
                      >
                        {s.employee.name}
                      </Link>
                    </td>
                    <td className="p-3">
                      {s.start.toLocaleDateString('uk-UA', { timeZone: 'UTC' })} —{' '}
                      {s.end.toLocaleDateString('uk-UA', { timeZone: 'UTC' })}
                    </td>
                    <td className="p-3">{s.status === 'new' ? 'Новий' : 'Завершено'}</td>
                    <td className="p-3 text-right font-semibold">
                      {s.total.toFixed(2).replace('.', ',')} грн
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {documents?.data && (
              <nav className="flex gap-4 p-4" aria-label="Сторінки нарахувань">
                {documents.data.page > 1 && (
                  <Link href={'?tab=documents&page=' + (documents.data.page - 1)}>Назад</Link>
                )}
                <span>Сторінка {documents.data.page}</span>
                {documents.data.page * 50 < documents.data.count && (
                  <Link href={'?tab=documents&page=' + (documents.data.page + 1)}>Далі</Link>
                )}
              </nav>
            )}
            {!slips.length && <p className="p-4">Проведених документів ще немає.</p>}
          </div>
        </>
      ) : (
        <>
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
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="p-3 text-left">Ім’я</th>
                  <th className="p-3 text-right">{payroll ? 'До виплати' : 'Робочі ролі'}</th>
                </tr>
              </thead>
              <tbody>
                {result.data.people.map((p) => {
                  const account = payroll?.data?.people.find((person) => person.id === p.id)
                  const balance = cents(account?.balance ?? '0')
                  return (
                    <tr className="border-t hover:bg-muted/40" key={p.id}>
                      <td className="p-3">
                        <Link
                          className="font-medium underline"
                          href={'/employees/' + encodeURIComponent(p.id)}
                        >
                          {p.name}
                        </Link>
                        {p.dismissedOn && ' · Звільнено'}
                      </td>
                      <td className="p-3 text-right font-semibold tabular-nums">
                        {account
                          ? decimal(balance).replace('.', ',') + ' грн'
                          : p.workRoles.map((r) => roles[r as keyof typeof roles]).join(', ')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  )
}
