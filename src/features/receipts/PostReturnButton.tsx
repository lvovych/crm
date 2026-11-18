'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { completeSupplierReturn } from './return-actions'
export function PostReturnButton({ id, version }: { id: string; version: number }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  return (
    <div>
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError('')
          try {
            const r = await completeSupplierReturn(id, version)
            if (!r.success) setError(r.error || 'Не вдалося провести документ.')
            else router.refresh()
          } catch {
            setError(
              'Не вдалося отримати відповідь. Оновіть сторінку та перевірте статус документа.'
            )
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? 'Проведення…' : 'Провести повернення'}
      </Button>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
