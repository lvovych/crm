'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslations } from 'next-intl'
import { receiptImportStatus, startReceiptImport } from './import-actions'

type Status = NonNullable<Awaited<ReturnType<typeof receiptImportStatus>>['data']>

export function ImportReceipts() {
  const t = useTranslations('integrations.receiptImport')
  const router = useRouter()
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const [requested, setRequested] = useState(0)
  const lastFinished = useRef<string | null>(null)
  const active = status?.job && ['queued', 'running'].includes(status.job.status)
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const result = await receiptImportStatus()
        if (stopped) return
        if (result.data) {
          setStatus(result.data)
          const job = result.data.job
          if (
            job &&
            ['done', 'failed', 'dead'].includes(job.status) &&
            lastFinished.current !== job.id
          ) {
            lastFinished.current = job.id
            router.refresh()
          }
        } else setError(result.error || t('error'))
      } catch {
        if (!stopped) setError(t('error'))
      }
      if (!stopped) timer = setTimeout(poll, 3000)
    }
    void poll()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [requested, router, t])

  return (
    <div className="flex max-w-xl flex-col items-start gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          disabled={pending || !!active || !status?.configured}
          onClick={() =>
            start(async () => {
              setError('')
              try {
                const result = await startReceiptImport()
                if (!result.success) setError(result.error || t('error'))
                else {
                  setStatus(
                    (s) =>
                      s && {
                        ...s,
                        job: { id: result.data!.jobId, status: 'queued', error: null, attempts: 0 },
                        progress: null,
                      }
                  )
                  setRequested((n) => n + 1)
                }
              } catch {
                setError(t('error'))
              }
            })
          }
        >
          {pending || active ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          {active ? t('working') : t('button')}
        </Button>
        {status && !status.configured && (
          <Link className="text-sm underline" href="/settings/integrations/ukrcar">
            {t('connect')}
          </Link>
        )}
      </div>
      <div role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {!status?.job && t('period')}
        {status?.job?.status === 'queued' && (status.job.attempts ? t('retry') : t('queued'))}
        {status?.job?.status === 'running' && t('working')}
        {status?.job?.status === 'done' && t('done')}
        {status?.job && ['failed', 'dead'].includes(status.job.status) && t('failed')}
        {status?.progress && <span className="block">{t('counts', status.progress)}</span>}
      </div>
      {(error || status?.job?.error) && (
        <p role="alert" className="text-sm text-destructive">
          {error || status?.job?.error}
        </p>
      )}
    </div>
  )
}
