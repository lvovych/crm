'use client'
import { useOperationText } from '@/i18n/use-operation-text'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { createServiceReceipts } from './subcontract-actions'

export function SubcontractReminder({
  recordId,
  unsaved,
  count,
}: {
  recordId: string
  unsaved?: boolean
  count: number
}) {
  const ot = useOperationText()

  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function createDrafts() {
    if (!recordId || busy || unsaved) return
    setBusy(true)
    try {
      const result = await createServiceReceipts(recordId)
      setMessage(
        result.success ? ot('Чернетки підготовлено.') : result.error || ot('Помилка створення.')
      )
      if (result.success) router.refresh()
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      {count > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border-2 border-primary/40 p-3">
          <Button type="button" disabled={busy || unsaved} onClick={createDrafts}>
            {ot("Прихід послуг - ")}
            {count}
          </Button>
          {unsaved && <small>{ot('Збережіть наряд, щоб створити чернетку приходу.')}</small>}
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </>
  )
}
