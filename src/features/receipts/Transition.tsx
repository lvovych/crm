'use client'
import { useOperationText } from '@/i18n/use-operation-text'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { changeReceipt } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
export function Transition({
  id,
  version,
  posting,
}: {
  id: string
  version: number
  posting: boolean
}) {
  const ot = useOperationText()

  const router = useRouter(),
    [busy, start] = useTransition(),
    [reason, setReason] = useState(''),
    [error, setError] = useState('')
  return (
    <form
      className="flex flex-wrap gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          const r = await changeReceipt(id, version, posting ? 'posted' : 'cancelled', reason)
          if (r.success) router.refresh()
          else setError(r.error || ot('Помилка'))
        })
      }}
    >
      {!posting && (
        <label>
          {ot('Причина скасування')}
          <small className="block">
            {ot('Зараховані на накладну оплати повернуться у вільний аванс.')}
          </small>
          <Input required value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      )}
      <Button disabled={busy} variant={posting ? 'default' : 'destructive'}>
        {posting ? ot('Провести') : ot('Скасувати проведення')}
      </Button>
      {error && <p role="alert">{error}</p>}
    </form>
  )
}
