import { getOperationText } from '@/i18n/operation-text.server'
import { DocumentHeader, DocumentStatus, MoneySummary } from '@/components/operations/document-ui'
import { EmployeeRules } from '@/features/payroll/EmployeeRules'
import { Lines } from '@/features/payroll/Lines'
import { fingerprint } from '@/features/finance/ledger'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  payrollData,
  finishSAL,
  assignOrder,
  previewSlip,
  postSlip,
} from '@/features/payroll/actions'

export default async function Payroll({
  searchParams,
}: {
  searchParams: Promise<{
    employee?: string
    start?: string
    end?: string
    mode?: string
    slip?: string
  }>
}) {
  const ot = await getOperationText()

  const q = await searchParams,
    r = await payrollData(q.employee || '')
  if (!r.data) return <p>{r.error}</p>
  const { people, employee, canManage } = r.data
  if (!employee) return <Link href="/employees">{ot('Додайте працівника')}</Link>
  const id = <input type="hidden" name="employee" value={employee.id} />
  const rules = q.mode === 'rules'
  const saved = q.slip ? r.data.slips.find((s) => s.id === q.slip) : undefined
  if (q.slip && !saved) return <p>{ot('Документ не знайдено.')}</p>
  if (saved)
    return (
      <main className="ops-workspace mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
        <Link href="/employees?tab=documents" className="underline">
          {ot('Документи нарахування')}
        </Link>
        <DocumentHeader
          title={'SAL · ' + employee.name}
          actions={
            <Link
              className="rounded-md border px-4 py-2 text-sm"
              href={'/documents/salary/' + saved.id}
            >
              {ot('Пов’язані виплати')}
            </Link>
          }
          status={
            <DocumentStatus tone={saved.status === 'completed' ? 'success' : 'neutral'}>
              {saved.status === 'new' ? ot('Новий') : ot('Завершено')}
            </DocumentStatus>
          }
        />
        <p>
          {saved.start.toISOString().slice(0, 10)} — {saved.end.toISOString().slice(0, 10)} ·{' '}
          {saved.status === 'new' ? ot('Новий') : ot('Завершено')}
        </p>
        <Lines details={saved.lines as unknown as import('@/features/payroll/Lines').SlipDetails} />
        <MoneySummary
          items={[{ label: ot('Нараховано'), value: saved.total.toFixed(2), emphasis: true }]}
        />
        {saved.status === 'new' && (
          <form action={finishSAL}>
            <input type="hidden" name="slip" value={saved.id} />
            <button className="rounded bg-primary px-4 py-2 text-primary-foreground">
              {ot('Завершити SAL')}
            </button>
          </form>
        )}
      </main>
    )
  const preview = q.start && q.end ? await previewSlip(employee.id, q.start, q.end) : null
  return (
    <main className="ops-workspace mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 [&_button]:rounded [&_button]:border [&_button]:px-3 [&_button]:py-1 [&_input]:rounded [&_input]:border [&_input]:p-1 [&_summary]:cursor-pointer">
      <Link
        className="text-sm underline"
        href={rules ? '/employees/' + encodeURIComponent(employee.id) : '/employees?tab=documents'}
      >
        {rules ? ot('Картка працівника') : ot('Документи нарахування')}
      </Link>
      <h1 className="text-3xl font-semibold">
        {rules ? ot('Правила нарахування') : ot('Новий документ нарахування')}
      </h1>
      <p className="text-xl font-medium">{employee.name}</p>
      {rules && (
        <>
          <EmployeeRules data={r.data} />
          {canManage && (
            <details className="rounded border p-4">
              <summary>{ot('Призначити відповідального за наряд')}</summary>
              <form action={assignOrder} className="flex flex-wrap gap-3 py-2">
                {id}
                <input name="order" required placeholder={ot('Номер або ID наряду')} />
                <select name="role">
                  <option value="partsId">{ot('Запчастист')}</option>
                  <option value="ownerId">{ot('Отримувач частки маржі')}</option>
                </select>
                <button>{ot('Призначити')}</button>
              </form>
            </details>
          )}
        </>
      )}
      {!rules && (
        <section className="ops-panel">
          <h2 className="text-xl font-semibold">{ot('Працівник і період')}</h2>
          <form className="ops-form my-5">
            <label className="grid gap-1 text-sm font-medium">
              {ot('Працівник')}
              <select className="rounded border p-2" name="employee" defaultValue={employee.id}>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {ot("Початок періоду ")}
              <input type="date" name="start" defaultValue={q.start} required />
            </label>
            <label>
              {ot("Кінець періоду ")}
              <input type="date" name="end" defaultValue={q.end} required />
            </label>
            <button>{ot('Попередній розрахунок')}</button>
          </form>
          {preview?.error && <p>{preview.error}</p>}
          {preview?.data && (
            <>
              <p className="my-4 text-lg font-semibold">
                {ot("До нарахування · ")}
                {preview.data.total} {ot(" грн")}
              </p>
              <Lines details={preview.data} />
              {canManage && (
                <form
                  action={async (form) => {
                    'use server'
                    form.set('draft', 'yes')
                    await postSlip(form)
                    redirect('/employees?tab=documents')
                  }}
                >
                  {id}
                  <input type="hidden" name="start" value={q.start} />
                  <input type="hidden" name="end" value={q.end} />
                  <input
                    type="hidden"
                    name="preview"
                    value={fingerprint({
                      lines: preview.data.lines,
                      conditions: preview.data.conditions,
                    })}
                  />
                  <details className="my-2">
                    <summary>{ot('Додати утримання або коригування')}</summary>
                    <select name="adjustType">
                      <option value="deduct">{ot('Утримання')}</option>
                      <option value="bonus">{ot('Донарахування')}</option>
                    </select>
                    <input
                      type="number"
                      min="0"
                      step=".01"
                      name="adjustAmount"
                      placeholder={ot('Сума, грн')}
                    />
                    <input
                      name="reason"
                      maxLength={300}
                      placeholder={ot('Підстава або номер попереднього листка')}
                    />
                  </details>
                  <button>{ot('Зберегти SAL · Новий')}</button>
                </form>
              )}
            </>
          )}
        </section>
      )}
      <Link href={'/employee-settlements?employee=' + employee.id} className="underline">
        {ot('Взаєморозрахунки з працівником')}
      </Link>
    </main>
  )
}
