'use client'
import { useState } from 'react'
import { addEmployeeRule } from './actions'
import { ruleLabels, type Basis } from './rules'

export function RuleForm({ employee, available }: { employee: string; available: Basis[] }) {
  const [selected, select] = useState(available[0])
  const basis = available.includes(selected) ? selected : available[0]
  return <form action={addEmployeeRule} className="my-3 flex flex-wrap items-end gap-3">
    <input type="hidden" name="employee" value={employee}/>
    <label>База <select name="basis" value={basis} onChange={e => select(e.target.value as Basis)}>
      {available.map(b => <option key={b} value={b}>{ruleLabels[b]}</option>)}
    </select></label>
    <label>Ставка, {basis === 'monthly' ? 'грн' : '%'} <input name="rate" required type="number" min=".01" max={basis === 'monthly' ? 999999999 : 100} step=".01"/></label>
    <label className="flex items-center gap-2"><input type="checkbox" name="afterDiscount" defaultChecked/> Враховувати знижки</label>
    <button type="submit" aria-label="Додати правило" title="Додати правило" className="inline-flex size-9 items-center justify-center rounded-md bg-primary text-xl font-semibold text-primary-foreground">+</button>
  </form>
}
