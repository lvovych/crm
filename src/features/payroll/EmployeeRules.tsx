import { useOperationText } from '@/i18n/use-operation-text'
import { removeAssignedRule, type payrollData } from './actions'
import { ruleLabels, ruleConditions } from './rules'
import { RuleForm } from './RuleForm'

export function EmployeeRules({
  data,
}: {
  data: NonNullable<Awaited<ReturnType<typeof payrollData>>['data']>
}) {
  const ot = useOperationText()

  const {
    employee,
    plans: [plan],
    canManage,
  } = data
  if (!employee) return null
  const bases = Object.keys(ruleLabels) as (keyof typeof ruleLabels)[]
  const active = bases.filter((b) => plan?.[b].gt(0))
  const available = bases.filter((b) => !active.includes(b))
  return (
    <section className="space-y-4 rounded border p-4">
      <h2 className="text-xl font-semibold">{ot('Правила нарахування зарплати')}</h2>
      {active.length && plan ? (
        <table className="w-full text-left text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="p-2">{ot('База')}</th>
              <th>{ot('Ставка')}</th>
              <th>{ot('Умови')}</th>
              {canManage && <th />}
            </tr>
          </thead>
          <tbody>
            {active.map((b) => (
              <tr key={b} className="border-b">
                <td className="p-2">{ot(ruleLabels[b])}</td>
                <td>
                  {plan[b].toString()}
                  {b === 'monthly' ? ot(" грн") : '%'}
                </td>
                <td>{ruleConditions(b, plan).split(' · ').map(ot).join(' · ')}</td>
                {canManage && (
                  <td>
                    <form action={removeAssignedRule}>
                      <input type="hidden" name="plan" value={plan.id} />
                      <input type="hidden" name="basis" value={b} />
                      <button aria-label={ot('Видалити правило «') + ot(ruleLabels[b]) + '»'}>
                        {ot('Видалити')}
                      </button>
                    </form>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>{ot('Правил ще немає.')}</p>
      )}
      {canManage && available.length > 0 && (
        <details>
          <summary>{ot('Додати правило')}</summary>
          <RuleForm employee={employee.id} available={available} />
        </details>
      )}
    </section>
  )
}
