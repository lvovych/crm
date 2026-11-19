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
  const lastFinished = useRef(new Set<string>())
  const active = status?.suppliers.some(
    (s) => s.job && ['queued', 'running'].includes(s.job.status)
  )
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const result = await receiptImportStatus()
        if (stopped) return
        if (result.data) {
          setStatus(result.data)
          for (const supplier of result.data.suppliers) {
            const job = supplier.job
            if (
              job &&
              ['done', 'failed', 'dead'].includes(job.status) &&
              !lastFinished.current.has(job.id)
            ) {
              lastFinished.current.add(job.id)
              router.refresh()
            }
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
                  const results = result.data!.results
                  setError(
                    results
                      .filter((r) => r.error)
                      .map((r) => r.error)
                      .join(' ')
                  )
                  setStatus(
                    (s) =>
                      s && {
                        ...s,
                        suppliers: s.suppliers.map((supplier) => {
                          const queued = results.find(
                            (r) => r.connectorId === supplier.connectorId && r.jobId
                          )
                          return queued
                            ? {
                                ...supplier,
                                job: {
                                  id: queued.jobId!,
                                  status: 'queued',
                                  error: null,
                                  attempts: 0,
                                },
                                progress: null,
                              }
                            : supplier
                        }),
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
          <Link className="text-sm underline" href="/settings/integrations">
            {t('connect')}
          </Link>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{t('period')}</p>
      {status?.suppliers.map((supplier) => (
        <div key={supplier.connectorId} className="w-full text-sm">
          <Link
            className="font-medium underline"
            href={`/settings/integrations/${supplier.connectorId}`}
          >
            {supplier.name}
          </Link>
          <div role="status" aria-live="polite" className="text-muted-foreground">
            {!supplier.configured && t('connect')}
            {supplier.job?.status === 'queued' &&
              (supplier.job.attempts ? t('retry') : t('queued'))}
            {supplier.job?.status === 'running' && t('working')}
            {supplier.job?.status === 'done' && t('done')}
            {supplier.job && ['failed', 'dead'].includes(supplier.job.status) && t('failed')}
            {supplier.progress && <span className="block">{t('counts', supplier.progress)}</span>}
          </div>
          {supplier.job?.error && (
            <p role="alert" className="text-destructive">
              {supplier.job.error}
            </p>
          )}
        </div>
      ))}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
