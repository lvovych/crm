import { createRule, deleteCatalogRule, removeAssignedRule, savePlan, type payrollData } from './actions'
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
        <div className="my-3 overflow-x-auto"><table className="w-full text-left text-sm tabular-nums">
          <thead className="bg-muted"><tr>{['Діє з', 'Правило', 'База', 'Ставка', ''].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead>
          <tbody>{plans.flatMap(plan => (Object.keys(fields) as (keyof typeof fields)[]).filter(basis => plan[basis].gt(0)).map(basis => {
            const rule = rules.find(item => item.basis === basis && plan.ruleIds.includes(item.id))
            return <tr key={plan.id + basis} className="border-b">
              <td className="p-2">{plan.effective.toLocaleDateString('uk-UA', { timeZone: 'UTC' })}</td>
              <td className="p-2 font-medium">{rule?.name ?? fields[basis].split(',')[0]}</td>
              <td className="p-2">{fields[basis].split(',')[0]}{basis === 'orderMargin' && <small className="block">{plan.includeNegativeOrderMargin ? 'Збиток враховується' : 'Збиток виключено'}</small>}</td>
              <td className="p-2">{plan[basis].toString()}{basis === 'monthly' ? ' грн' : '%'}</td>
              <td className="p-2">{canManage && <form action={removeAssignedRule}>
                <input type="hidden" name="plan" value={plan.id}/><input type="hidden" name="basis" value={basis}/>
                <button aria-label={'Зняти правило ' + (rule?.name ?? fields[basis])}>Зняти</button>
              </form>}</td>
            </tr>
          }))}</tbody>
        </table></div>
        <details className="my-4 rounded border p-3"><summary>Довідник правил</summary>
          <table className="mt-3 w-full text-left text-sm"><thead className="bg-muted"><tr>{['Назва','База','Ставка',''].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead>
            <tbody>{rules.map(rule => <tr key={rule.id} className="border-b">
              <td className="p-2">{rule.name}</td><td className="p-2">{fields[rule.basis as keyof typeof fields].split(',')[0]}</td>
              <td className="p-2">{rule.rate.toString()}{rule.basis === 'monthly' ? ' грн' : '%'}</td>
              <td>{canManage && <form action={deleteCatalogRule}><input type="hidden" name="rule" value={rule.id}/><button>Видалити з довідника</button></form>}</td>
            </tr>)}</tbody></table>
        </details>
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
