import { Lines } from '@/features/payroll/Lines'
import { fingerprint } from '@/features/finance/ledger'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  payrollData,
  savePlan, createRule, finishSAL,
  assignOrder,
  previewSlip,
  postSlip,
} from '@/features/payroll/actions'

const fields = {
  monthly: 'Ставка на місяць, грн',
  labor: 'Роботи, %',
  partsSales: 'Продаж запчастин, %',
  partsMargin: 'Маржа запчастин, %',
  orderMargin: 'Маржа наряду, %',
}
const frequencies = { weekly: 'Щотижня', twice: 'Двічі на місяць', monthly: 'Щомісяця' }
export default async function Payroll({
  searchParams,
}: {
  searchParams: Promise<{ employee?: string; start?: string; end?: string; mode?: string; slip?: string }>
}) {
  const q = await searchParams,
    r = await payrollData(q.employee || '')
  if (!r.data) return <p>{r.error}</p>
  const { people, employee, plans, canManage } = r.data
  if (!employee) return <Link href="/employees">Додайте працівника</Link>
  const id = <input type="hidden" name="employee" value={employee.id} />
  const rules = q.mode === 'rules'
  const saved = q.slip ? r.data.slips.find(s => s.id === q.slip) : undefined
  if (q.slip && !saved) return <p>Документ не знайдено.</p>
  if (saved) return <main className="mx-auto w-full max-w-5xl space-y-5 p-6">
    <Link href="/employees?tab=documents" className="underline">Документи нарахування</Link>
    <h1 className="text-2xl font-semibold">SAL · {employee.name}</h1>
    <p>{saved.start.toISOString().slice(0,10)} — {saved.end.toISOString().slice(0,10)} · {saved.status === 'new' ? 'Новий' : 'Завершено'}</p>
    <Lines lines={saved.lines as unknown as import('@/features/payroll/calculation').SlipLine[]} />
    <strong>Нараховано · {saved.total.toFixed(2)} грн</strong>
    {saved.status === 'new' && <form action={finishSAL}><input type="hidden" name="slip" value={saved.id}/><button className="rounded bg-primary px-4 py-2 text-primary-foreground">Завершити SAL</button></form>}
  </main>
  const preview = q.start && q.end ? await previewSlip(employee.id, q.start, q.end) : null
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6 [&_button]:rounded [&_button]:border [&_button]:px-3 [&_button]:py-1 [&_input]:rounded [&_input]:border [&_input]:p-1 [&_summary]:cursor-pointer">
      <Link className="text-sm underline" href={rules ? '/employees?employee='+employee.id+'#card' : '/employees?tab=documents'}>{rules ? 'Картка працівника' : 'Документи нарахування'}</Link>
      <h1 className="text-3xl font-semibold">{rules ? 'Правила нарахування' : 'Новий документ нарахування'}</h1>
      <p className="text-xl font-medium">{employee.name}</p>
      {rules && <>
      <section className="rounded border p-4">
        <h2 className="text-xl font-semibold">Умови оплати</h2>
        {plans.map((p) => (
          <p key={p.id}>
            Від {p.effective.toISOString().slice(0, 10)} ·{' '}
            {frequencies[p.frequency as keyof typeof frequencies]} ·{' '}
            {Object.entries(fields)
              .filter(([k]) => Number(p[k as keyof typeof fields]) > 0)
              .map(([k, label]) => label + ' ' + p[k as keyof typeof fields])
              .join(' · ')}
            {p.orderMargin.gt(0) &&
              (p.includeNegativeOrderMargin
                ? ' · Збиток зменшує зарплату'
                : ' · За збитковий наряд частка маржі — 0 грн')}
          </p>
        ))}
        <details className="my-4 rounded border p-3"><summary>Створити правило</summary>
          <form action={createRule} className="mt-3 flex flex-wrap items-end gap-3">
            <label>Назва <input name="name" required /></label>
            <label>База <select name="basis">{Object.entries(fields).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Значення <input name="rate" required type="number" min=".01" step=".01"/></label>
            <button>Створити правило</button>
          </form></details>
        {canManage && (
          <details>
            <summary>Додати умову</summary>
            <form action={savePlan} className="grid gap-2 py-3 sm:grid-cols-2">
              {id}
              <label>
                Діють з <input type="date" required name="effective" />
              </label>
              <select name="frequency">
                {Object.entries(frequencies).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <fieldset className="space-y-2"><legend>Правила нарахування</legend>
                {r.data.rules.map(rule => <label key={rule.id} className="block"><input type="checkbox" name="rule" value={rule.id}/> {rule.name} · {fields[rule.basis as keyof typeof fields]} {rule.rate.toString()}</label>)}
              </fieldset>
              <label>
                <input type="checkbox" name="afterDiscount" defaultChecked /> Враховувати знижки у
                продажах і роботах
              </label>
              <label>
                <input type="checkbox" name="marginAfterDiscount" defaultChecked /> Враховувати
                знижки у маржі
              </label>
              <label>
                <input type="checkbox" name="includeNegativeOrderMargin" /> Враховувати від’ємну
                маржу всього наряду
              </label>
              <button>Зберегти умови</button>
            </form>
          </details>
        )}
      </section>
      {canManage && (
        <details className="rounded border p-4">
          <summary>Призначити відповідального за наряд</summary>
          <form action={assignOrder} className="flex flex-wrap gap-3 py-2">
            {id}
            <input name="order" required placeholder="Номер або ID наряду" />
            <select name="role">
              <option value="partsId">Запчастист</option>
              <option value="ownerId">Отримувач частки маржі</option>
            </select>
            <button>Призначити</button>
          </form>
        </details>
      )}
      </>}
      {!rules && <section className="rounded-lg border p-5">
        <h2 className="text-xl font-semibold">Працівник і період</h2>
        <form className="my-3 flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm font-medium">Працівник<select className="rounded border p-2" name="employee" defaultValue={employee.id}>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>
            Початок періоду <input type="date" name="start" defaultValue={q.start} required />
          </label>
          <label>Кінець періоду <input type="date" name="end" defaultValue={q.end} required /></label>
          <button>Попередній розрахунок</button>
        </form>
        {preview?.error && <p>{preview.error}</p>}
        {preview?.data && (
          <>
            <p className="my-4 text-lg font-semibold">До нарахування · {preview.data.total} грн</p>
            <Lines lines={preview.data.lines} />
            {canManage && (
              <form action={async (form) => {
                'use server'
                form.set('draft', 'yes')
                await postSlip(form)
                redirect('/employees?tab=documents')
              }}>
                {id}
                <input type="hidden" name="start" value={q.start} />
                <input type="hidden" name="end" value={q.end} />
                <input type="hidden" name="preview" value={fingerprint(preview.data.lines)} />
                <details className="my-2">
                  <summary>Додати утримання або коригування</summary>
                  <select name="adjustType">
                    <option value="deduct">Утримання</option>
                    <option value="bonus">Донарахування</option>
                  </select>
                  <input
                    type="number"
                    min="0"
                    step=".01"
                    name="adjustAmount"
                    placeholder="Сума, грн"
                  />
                  <input
                    name="reason"
                    maxLength={300}
                    placeholder="Підстава або номер попереднього листка"
                  />
                </details>
                <button>Зберегти SAL · Новий</button>
              </form>
            )}
          </>
        )}
      </section>}
      <Link href={'/employee-settlements?employee=' + employee.id} className="underline">
        Взаєморозрахунки з працівником
      </Link>
    </main>
  )
}
