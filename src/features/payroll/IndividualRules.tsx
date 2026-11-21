'use client'
import { useState, useTransition } from 'react'
import { commissionLabels, type CommissionRule } from './commission-rules'
import { saveCommissionRule } from './document-actions'
export const payrollButton =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50'
export const payrollPrimary =
  payrollButton + ' border-primary bg-primary text-primary-foreground hover:bg-primary/90'
export const payrollControl = 'min-h-10 w-full rounded-md border bg-background px-3 py-2 text-sm'
export const payrollField = 'grid gap-2 text-sm font-medium'

export function IndividualRules({
  person,
  canManage,
  today,
  onChanged,
}: {
  person: { id: string; rules: CommissionRule[]; roles?: string[] }
  canManage: boolean
  today: string
  onChanged: () => void
}) {
  const latest = new Map<string, CommissionRule>()
  for (const r of [...person.rules].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) ||
      a.effective.localeCompare(b.effective) ||
      a.id.localeCompare(b.id)
  ))
    latest.set(r.ruleKey, r)
  const [editing, setEditing] = useState<CommissionRule | null | undefined>(undefined)
  const [basis, setBasis] = useState<CommissionRule['basis']>('partsMargin')
  const [error, setError] = useState(''),
    [pending, run] = useTransition()
  const open = (rule: CommissionRule | null) => {
    setEditing(rule)
    setBasis(rule?.basis || 'partsMargin')
    setError('')
  }
  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        {[...latest.values()].map((r) => (
          <article className="rounded-xl border bg-card p-5" key={r.ruleKey}>
            <div className="flex justify-between gap-4">
              <div>
                <h2 className="font-semibold">{r.name}</h2>
                <p className="text-xs text-muted-foreground">
                  {commissionLabels[r.basis]} ·{' '}
                  {r.scope === 'performer'
                    ? 'виконавець'
                    : r.scope === 'seller'
                      ? 'продавець запчастин'
                      : r.scope === 'workshop'
                        ? 'усі наряди сервісу'
                        : 'менеджер наряду'}
                </p>
              </div>
              <strong className="text-xl">{Number(r.rate)}%</strong>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              {r.afterDiscount ? 'Після знижок' : 'До знижок'}
              {['managerLabor', 'orderMargin'].includes(r.basis) && r.deductMechanicPay
                ? ' · після винагороди механіка'
                : ''}
            </p>
            <div className="mt-4 flex justify-between gap-3 border-t pt-3 text-xs">
              <span>
                {r.enabled ? 'Діє' : 'Призупинено'} з {r.effective}
              </span>
              {canManage && (
                <button className="underline" onClick={() => open(r)}>
                  Змінити умови
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {canManage && (
        <button className={payrollButton} onClick={() => open(null)}>
          + Додати правило
        </button>
      )}
      {editing !== undefined && (
        <form
          key={editing?.id || 'new'}
          className="space-y-5 rounded-xl border bg-card p-5"
          onSubmit={(e) => {
            e.preventDefault()
            const form = new FormData(e.currentTarget)
            run(async () => {
              setError('')
              const result = await saveCommissionRule({
                employee: person.id,
                ruleKey: editing?.ruleKey,
                previous: editing?.id,
                allowOverlap: form.has('allowOverlap'),
                rule: {
                  name: String(form.get('name')),
                  basis,
                  scope: String(form.get('scope')),
                  rate: form.get('rate'),
                  effective: String(form.get('effective')),
                  enabled: form.has('enabled'),
                  afterDiscount: form.has('afterDiscount'),
                  deductMechanicPay: form.has('deductMechanicPay'),
                  deductSubcontractCost: form.has('deductSubcontractCost'),
                  includeNegative: form.has('includeNegative'),
                },
              })
              if (!result.success) {
                setError(result.error || 'Не вдалося зберегти.')
                return
              }
              setEditing(undefined)
              onChanged()
            })
          }}
        >
          <h2 className="text-lg font-semibold">
            {editing ? 'Нова версія правила' : 'Нове правило'}
          </h2>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={payrollField}>
              Назва правила
              <input
                className={payrollControl}
                name="name"
                required
                maxLength={120}
                defaultValue={editing?.name || 'Винагорода працівника'}
              />
            </label>
            <label className={payrollField}>
              База нарахування
              <select
                aria-label="База нарахування"
                className={payrollControl}
                value={basis}
                onChange={(e) => setBasis(e.target.value as CommissionRule['basis'])}
              >
                {Object.entries(commissionLabels).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className={payrollField}>
              Ставка, %
              <input
                className={payrollControl}
                type="number"
                name="rate"
                min="0.01"
                max="100"
                step="0.01"
                required
                defaultValue={editing?.rate || '10'}
              />
            </label>
            <label className={payrollField}>
              Які позиції враховувати
              <select
                key={basis}
                className={payrollControl}
                name="scope"
                aria-label="Які позиції враховувати"
                defaultValue={
                  editing?.basis === basis
                    ? editing.scope
                    : basis === 'labor'
                      ? 'performer'
                      : person.roles?.includes('advisor')
                        ? 'workshop'
                        : 'manager'
                }
              >
                {basis === 'labor' ? (
                  <option value="performer">Власні виконані роботи</option>
                ) : (
                  <>
                    <option value="workshop">Усі закриті наряди сервісу</option>
                    <option value="manager">Де працівник — менеджер наряду</option>
                    {['partsSales', 'partsMargin'].includes(basis) && (
                      <option value="seller">Де працівник — продавець запчастин</option>
                    )}
                  </>
                )}
              </select>
            </label>
            <label className={payrollField}>
              Діє з
              <input
                className={payrollControl}
                type="date"
                required
                name="effective"
                defaultValue={today}
              />
            </label>
          </div>
          <div className="grid gap-3 text-sm">
            <label className="flex gap-2">
              <input type="checkbox" name="enabled" defaultChecked={editing?.enabled ?? true} />
              Правило активне з обраної дати
            </label>
            <label className="flex gap-2">
              <input
                type="checkbox"
                name="afterDiscount"
                defaultChecked={editing?.afterDiscount ?? true}
              />
              Враховувати знижки клієнту
            </label>
            {['managerLabor', 'orderMargin'].includes(basis) && (
              <>
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    name="deductMechanicPay"
                    defaultChecked={editing?.deductMechanicPay ?? true}
                  />
                  Відняти винагороду механіків
                </label>
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    name="deductSubcontractCost"
                    defaultChecked={editing?.deductSubcontractCost ?? true}
                  />
                  Відняти витрати на підрядників
                </label>
              </>
            )}
            <label className="flex gap-2">
              <input
                type="checkbox"
                name="includeNegative"
                defaultChecked={editing?.includeNegative ?? false}
              />
              Враховувати від’ємну базу як мінус у нарахуванні
            </label>
            <label className="flex gap-2">
              <input type="checkbox" name="allowOverlap" />
              Дозволити одночасне нарахування за правилами з базами, що перетинаються
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Попередні версії зберігаються. Проведені документи залишаються незмінними. Закриття
            наряду — обов’язкова умова для всіх правил.
          </p>
          <div className="flex gap-3">
            <button className={payrollPrimary} disabled={pending}>
              Зберегти правило
            </button>
            <button type="button" className={payrollButton} onClick={() => setEditing(undefined)}>
              Скасувати
            </button>
          </div>
        </form>
      )}
      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-medium">Історія змін правил</summary>
        <ul className="mt-4 space-y-3 text-sm">
          {[...person.rules]
            .sort(
              (a, b) =>
                b.effective.localeCompare(a.effective) || b.createdAt.localeCompare(a.createdAt)
            )
            .map((r) => (
              <li key={r.id} className="border-t pt-3">
                {r.effective} · {r.name} · {Number(r.rate)}% ·{' '}
                {r.enabled ? 'активне' : 'призупинено'}
              </li>
            ))}
        </ul>
      </details>
    </div>
  )
}
