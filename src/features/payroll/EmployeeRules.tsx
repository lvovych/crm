import { removeAssignedRule, type payrollData } from './actions'
import { ruleLabels, ruleConditions } from './rules'
import { RuleForm } from './RuleForm'

export function EmployeeRules({ data }: { data: NonNullable<Awaited<ReturnType<typeof payrollData>>['data']> }) {
  const { employee, plans: [plan], canManage } = data
  if (!employee) return null
  const bases = Object.keys(ruleLabels) as (keyof typeof ruleLabels)[]
  const active = bases.filter(b => plan?.[b].gt(0))
  const available = bases.filter(b => !active.includes(b))
  return <section className="space-y-4 rounded border p-4">
    <h2 className="text-xl font-semibold">Правила нарахування зарплати</h2>
    {active.length && plan ? <table className="w-full text-left text-sm">
      <thead className="bg-muted"><tr><th className="p-2">База</th><th>Ставка</th><th>Умови</th>{canManage && <th/>}</tr></thead>
      <tbody>{active.map(b => <tr key={b} className="border-b">
        <td className="p-2">{ruleLabels[b]}</td><td>{plan[b].toString()}{b === 'monthly' ? ' грн' : '%'}</td>
        <td>{ruleConditions(b, plan)}</td>
        {canManage && <td><form action={removeAssignedRule}>
          <input type="hidden" name="plan" value={plan.id}/><input type="hidden" name="basis" value={b}/>
          <button aria-label={'Видалити правило «' + ruleLabels[b] + '»'}>Видалити</button>
        </form></td>}
      </tr>)}</tbody>
    </table> : <p>Правил ще немає.</p>}
    {canManage && available.length > 0 && <details><summary>Додати правило</summary>
      <RuleForm employee={employee.id} available={available}/>
    </details>}
  </section>
}
