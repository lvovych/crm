import { createRule, savePlan, type payrollData } from './actions'
const fields = {
  monthly: 'Ставка на місяць, грн',
  labor: 'Роботи, %',
  partsSales: 'Продаж запчастин, %',
  partsMargin: 'Маржа запчастин, %',
  orderMargin: 'Маржа наряду, %',
}
const frequencies = { weekly: 'Щотижня', twice: 'Двічі на місяць', monthly: 'Щомісяця' }
export function EmployeeRules({ data }: { data: NonNullable<Awaited<ReturnType<typeof payrollData>>['data']> }) {
  const { employee, plans, rules, canManage } = data
  if (!employee) return null
  const id = <input type="hidden" name="employee" value={employee.id} />
  return (
      <section className="rounded border p-4">
        <h2 className="text-xl font-semibold">Правила нарахування зарплати</h2>
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
                {rules.map(rule => <label key={rule.id} className="block"><input type="checkbox" name="rule" value={rule.id}/> {rule.name} · {fields[rule.basis as keyof typeof fields]} {rule.rate.toString()}</label>)}
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
  )
}
