'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { previewSupplierImport } from '../Actions/importActions'
type Preview = NonNullable<Awaited<ReturnType<typeof previewSupplierImport>>['data']>
export function SupplierImportPreview() {
  const t = useTranslations('suppliers')
  const [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [preview, setPreview] = useState<Preview | null>(null)
  return (
    <div className="space-y-4">
      <p>{t('importHelp')}</p>
      <input
        aria-label={t('importTitle')}
        type="file"
        accept=".json,application/json"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null)
          setPreview(null)
          setError('')
        }}
      />
      <Button
        disabled={!file || busy}
        onClick={async () => {
          if (!file) return
          if (file.size > 8 * 1024 * 1024) {
            setError(t('fileTooLarge'))
            return
          }
          setBusy(true)
          setError('')
          try {
            const r = await previewSupplierImport(await file.text())
            if (r.data) setPreview(r.data)
            else setError(r.error ?? t('error'))
          } catch {
            setError(t('error'))
          } finally {
            setBusy(false)
          }
        }}
      >
        {t('preview')}
      </Button>
      <p className="text-muted-foreground">{t('previewOnly')}</p>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {preview && (
        <>
          <p>
            {preview.periodStart} — {preview.snapshotAt}
          </p>
          {!preview.complete && (
            <p role="alert" className="text-destructive">
              {t('incomplete')}
            </p>
          )}
          <p>
            {Object.entries(preview.summary)
              .map(([k, v]) => (k === 'total' ? t('total', { count: v }) : t(k) + ': ' + v))
              .join(' · ')}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  {['name', 'status', 'evidence', 'duplicates'].map((k) => (
                    <th className="p-2" key={k}>
                      {t(k)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.items.map((i) => (
                  <tr className="border-t" key={i.externalSupplierId}>
                    <td className="p-2">
                      {i.name}
                      <p className="text-muted-foreground">
                        ID {i.externalSupplierId}
                        {i.isArchived ? ' · ' + t('archived') : ''}
                      </p>
                      {i.hasOutstandingBalance && <p>{t('outstanding')}</p>}
                    </td>
                    <td className="p-2">{t(i.decision)}</td>
                    <td className="p-2">
                      <details>
                        <summary>{i.evidence.length}</summary>
                        {i.evidence.map((e) => (
                          <p key={e.kind + e.externalId}>
                            {e.kind} {e.externalId} · {e.date}
                          </p>
                        ))}
                        {!i.evidence.length && t('noEvidence')}
                      </details>
                    </td>
                    <td className="p-2">
                      {i.conflicts.map((c) => (
                        <p key={c.source + c.id}>
                          {c.name} ({c.source} / {c.id}) —{' '}
                          {t(
                            c.reason === 'taxId'
                              ? 'taxIdMatch'
                              : c.reason === 'name'
                                ? 'nameMatch'
                                : c.reason === 'differentTaxId'
                                  ? 'differentTaxId'
                                  : 'contactMatch'
                          )}
                        </p>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
