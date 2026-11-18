'use client'
import { useOperationText } from '@/i18n/use-operation-text'
import { type ReactNode, useEffect, useState } from 'react'
import { financeChoices } from './actions'
export function AccountSelect({
  value,
  onChange,
  name = 'moneyAccountId',
  inactiveFallback,
}: {
  value?: string
  onChange?: (value: string) => void
  name?: string
  inactiveFallback?: ReactNode
}) {
  const ot = useOperationText()

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
    return <p role="alert">{ot('Не вдалося завантажити каси. Оновіть сторінку перед оплатою.')}</p>
  if (!state)
    return (
      <label className="block space-y-1 text-sm">
        <span>{ot('Каса / рахунок')}</span>
        <select
          name={name}
          required
          aria-label={ot('Каса / рахунок')}
          aria-busy="true"
          disabled
          defaultValue=""
          className="h-11 w-full rounded-md border bg-background px-3"
        >
          <option value="">{ot('Завантаження рахунків…')}</option>
        </select>
      </label>
    )
  if (!state.active) return inactiveFallback ?? null
  return (
    <label className="block space-y-1">
      <span>{ot('Каса / рахунок')}</span>
      <select
        key="loaded-accounts"
        name={name}
        aria-label={ot('Каса / рахунок')}
        required
        value={value}
        defaultValue={
          value === undefined && state.accounts.length === 1 ? state.accounts[0].id : undefined
        }
        onChange={(e) => onChange?.(e.target.value)}
        className="h-11 w-full rounded-md border bg-background px-3"
      >
        <option value="">{ot('Оберіть касу або рахунок')}</option>
        {state.accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      {state.accounts.length === 0 && (
        <span className="text-sm text-destructive">
          {ot('Немає доступних кас. Зверніться до адміністратора.')}
        </span>
      )}
    </label>
  )
}
