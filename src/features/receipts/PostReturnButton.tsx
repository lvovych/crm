'use client'
import { useOperationText } from '@/i18n/use-operation-text'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { completeSupplierReturn } from './return-actions'
export function PostReturnButton({ id, version }: { id: string; version: number }) {
  const ot = useOperationText()

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
            if (!r.success) setError(r.error || ot('Не вдалося провести документ.'))
            else router.refresh()
          } catch {
            setError(
              ot('Не вдалося отримати відповідь. Оновіть сторінку та перевірте статус документа.')
            )
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? ot('Проведення…') : ot('Провести повернення')}
      </Button>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
