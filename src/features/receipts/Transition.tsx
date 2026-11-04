'use client'
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
          else setError(r.error || 'Помилка')
        })
      }}
    >
      {!posting && (
        <label>
          Причина скасування
          <Input required value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      )}
      <Button disabled={busy} variant={posting ? 'default' : 'destructive'}>
        {posting ? 'Провести' : 'Скасувати проведення'}
      </Button>
      {error && <p role="alert">{error}</p>}
    </form>
  )
}
