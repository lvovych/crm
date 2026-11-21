import { getOperationText } from '@/i18n/operation-text.server'
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
  searchParams: Promise<{ tab?: string; employee?: string; page?: string; archive?: string }>
}) {
  const ot = await getOperationText()

  const result = await directory()
  if (!result.data) return <p>{result.error}</p>
  const query = await searchParams
  const visiblePeople = result.data.people.filter(
    (p) => query.archive === '1' || (p.isActive && !p.dismissedOn)
  )
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
        {ot('Довідники')}
      </Link>
      <h1 className="flex items-center gap-3 text-3xl font-semibold">
        <UserRound aria-hidden="true" />
        {ot('Працівники')}
      </h1>
      <nav className="flex border-b">
        <Link className={tabClass(!docs)} href="/employees">
          {ot('Список працівників')}
        </Link>
        {payroll && (
          <Link className={tabClass(docs)} href="/employees?tab=documents">
            {ot('Документи нарахування')}
          </Link>
        )}
      </nav>
      {docs ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">{ot('Документи нарахування')}</h2>
            <Link className={button} href="/payroll?mode=new">
              {ot('Створити документ')}
            </Link>
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-sm tabular-nums">
              <thead className="bg-muted">
                <tr>
                  {[ot('Працівник'), ot('Період'), ot('Статус'), ot('Нараховано')].map((h) => (
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
                    <td className="p-3">{s.status === 'new' ? ot('Новий') : ot('Завершено')}</td>
                    <td className="p-3 text-right font-semibold">
                      {s.total.toFixed(2).replace('.', ',')} {ot(' грн')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {documents?.data && (
              <nav className="flex gap-4 p-4" aria-label={ot('Сторінки нарахувань')}>
                {documents.data.page > 1 && (
                  <Link href={'?tab=documents&page=' + (documents.data.page - 1)}>
                    {ot('Назад')}
                  </Link>
                )}
                <span>
                  {ot('Сторінка ')}
                  {documents.data.page}
                </span>
                {documents.data.page * 50 < documents.data.count && (
                  <Link href={'?tab=documents&page=' + (documents.data.page + 1)}>
                    {ot('Далі')}
                  </Link>
                )}
              </nav>
            )}
            {!slips.length && <p className="p-4">{ot('Проведених документів ще немає.')}</p>}
          </div>
        </>
      ) : (
        <>
          {result.data?.canManage && (
            <details className="rounded border p-4">
              <summary>{ot('Додати працівника')}</summary>
              <form action={saveEmployee} className="mt-4 space-y-3">
                <input
                  className="rounded border p-2"
                  name="name"
                  aria-label={ot('Ім’я')}
                  placeholder={ot('Ім’я та прізвище')}
                  required
                />
                <RoleFields selected={['mechanic']} />
                <button>{ot('Створити')}</button>
              </form>
            </details>
          )}
          <p className="text-sm text-muted-foreground">
            Активні працівники та їхні облікові записи CRM. Імпортовані неактивні картки доступні в
            архіві.
          </p>
          <Link
            className="text-sm underline"
            href={query.archive === '1' ? '/employees' : '/employees?archive=1'}
          >
            {query.archive === '1'
              ? 'Показати лише активних'
              : 'Показати також архівних працівників'}
          </Link>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="p-3 text-left">{ot('Ім’я')}</th>
                  <th className="p-3 text-right">
                    {payroll ? ot('До виплати') : ot('Робочі ролі')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visiblePeople.map((p) => {
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
                        {p.dismissedOn && ot(' · Звільнено')}
                        {!p.isActive && ' · Архів'}
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {p.crmRole ||
                            p.workRoles.map((r) => ot(roles[r as keyof typeof roles])).join(', ')}
                          {p.userId ? ' · Обліковий запис CRM' : ''}
                        </span>
                      </td>
                      <td className="p-3 text-right font-semibold tabular-nums">
                        {account
                          ? decimal(balance).replace('.', ',') + ot(' грн')
                          : p.workRoles.map((r) => ot(roles[r as keyof typeof roles])).join(', ')}
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
