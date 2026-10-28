'use client'
import { useEffect, useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getLedgerProviderAccounts, setLedgerProviderAccount } from '../Actions/ledgerActions'
type Data = NonNullable<Awaited<ReturnType<typeof getLedgerProviderAccounts>>['data']>
export function ProviderAccounts() {
  const [data, setData] = useState<Data>(),
    [provider, setProvider] = useState('stripe'),
    [account, setAccount] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0)
  const keys = useRef(new Map<string, string>())
  useEffect(() => {
    let live = true
    getLedgerProviderAccounts()
      .then((r) => {
        if (live) {
          setData(r.data)
          setMessage(r.error ?? '')
        }
      })
      .catch(() => {
        if (live) setMessage('Не вдалося завантажити налаштування')
      })
    return () => {
      live = false
    }
  }, [revision])
  async function save() {
    const fingerprint = provider + ':' + account
    if (!keys.current.has(fingerprint)) keys.current.set(fingerprint, crypto.randomUUID())
    setBusy(true)
    setMessage('')
    try {
      const r = await setLedgerProviderAccount({
        provider,
        accountId: account,
        idempotencyKey: keys.current.get(fingerprint),
      })
      if (!r.success) setMessage(r.error ?? 'Помилка')
      else {
        setRevision((v) => v + 1)
        setMessage('Рахунок провайдера збережено')
      }
    } catch {
      setMessage('Немає відповіді. Повторіть запит.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <details className="rounded border p-3">
      <summary className="cursor-pointer font-semibold">Рахунки платіжних інтеграцій</summary>
      <div className="mt-3 grid gap-3">
        <p>
          Підтверджені онлайн-оплати нового обліку надходять на явно вибраний рахунок. Без
          налаштування операція відхиляється для повторної доставки провайдером. Історичний облік не
          змінюється.
        </p>
        {message && <p role="status">{message}</p>}
        {data?.settings.map((s) => (
          <p key={s.key}>
            {s.key.replace('stockLedger.vendorAccount.', '')} →{' '}
            {data.accounts.find((a) => a.id === s.value)?.name ?? 'Архівований рахунок'}
          </p>
        ))}
        <label>
          Код провайдера
          <Input
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            placeholder="stripe, paypal, vipps, quickbooks"
          />
        </label>
        <label>
          Рахунок для надходження
          <select
            className="min-h-11 w-full rounded border bg-background p-2"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          >
            <option value="">Виберіть рахунок</option>
            {data?.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          onClick={save}
          disabled={busy || !account || !/^[a-z0-9_-]{1,40}$/.test(provider)}
        >
          Зберегти рахунок провайдера
        </Button>
      </div>
    </details>
  )
}
