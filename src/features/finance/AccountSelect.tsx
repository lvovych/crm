'use client'
import { useEffect, useState } from 'react'
import { financeChoices } from './actions'
export function AccountSelect({
  value,
  onChange,
  name = 'moneyAccountId',
}: {
  value?: string
  onChange?: (value: string) => void
  name?: string
}) {
  const [state, setState] = useState<Awaited<ReturnType<typeof financeChoices>>['data']>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    financeChoices()
      .then((r) => {
        if (live) {
          if (r.success) setState(r.data)
          else setFailed(true)
        }
      })
      .catch(() => {
        if (live) setFailed(true)
      })
    return () => {
      live = false
    }
  }, [])
  useEffect(() => {
    if (state?.accounts.length === 1 && !value) onChange?.(state.accounts[0].id)
  }, [state, value, onChange])
  if (failed)
    return <p role="alert">Не вдалося завантажити каси. Оновіть сторінку перед оплатою.</p>
  if (!state?.active) return null
  return (
    <label className="block space-y-1">
      <span>Каса / рахунок</span>
      <select
        name={name}
        aria-label="Каса / рахунок"
        required
        value={value}
        defaultValue={
          value === undefined && state.accounts.length === 1 ? state.accounts[0].id : undefined
        }
        onChange={(e) => onChange?.(e.target.value)}
        className="h-11 w-full rounded-md border bg-background px-3"
      >
        <option value="">Оберіть касу</option>
        {state.accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      {state.accounts.length === 0 && (
        <span className="text-sm text-destructive">
          Немає доступних кас. Зверніться до адміністратора.
        </span>
      )}
    </label>
  )
}
