'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { archiveSupplier } from '../Actions/supplierActions'
export function ArchiveSupplier({ id, archived }: { id: string; archived: boolean }) {
  const t = useTranslations('suppliers'),
    router = useRouter()
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  return (
    <div>
      <Button
        disabled={busy}
        variant="outline"
        onClick={async () => {
          if (!archived && !window.confirm(t('archiveConfirm'))) return
          setBusy(true)
          try {
            const r = await archiveSupplier(id, !archived)
            if (r.success) router.refresh()
            else setError(r.error ?? t('error'))
          } catch {
            setError(t('error'))
          } finally {
            setBusy(false)
          }
        }}
      >
        {t(archived ? 'restore' : 'archive')}
      </Button>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
