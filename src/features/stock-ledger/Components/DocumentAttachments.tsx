'use client'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
type Row = { id: string; name: string; size: number; createdAt: string; sha256: string }
export function DocumentAttachments({
  kind,
  id,
  canUpload = false,
}: {
  kind: 'receipt' | 'subcontract' | 'payment'
  id: string
  canUpload?: boolean
}) {
  const [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [file, setFile] = useState<File>(),
    [revision, setRevision] = useState(0)
  const key = useRef(crypto.randomUUID()),
    input = useRef<HTMLInputElement>(null),
    url = `/api/protected/stock-ledger/attachments/${kind}/${encodeURIComponent(id)}`
  useEffect(() => {
    let live = true
    fetch(url)
      .then((r) => r.json())
      .then((r) => {
        if (live) {
          if (r.success) setRows(r.data)
          else setError(r.error ?? 'Не вдалося завантажити вкладення')
        }
      })
      .catch(() => {
        if (live) setError('Немає зв’язку із сервером')
      })
    return () => {
      live = false
    }
  }, [url, revision])
  async function upload() {
    if (!file) return
    if (file.size > 10485760) {
      setError('Максимальний розмір — 10 МБ')
      return
    }
    const form = new FormData()
    form.set('file', file)
    form.set('idempotencyKey', key.current)
    setBusy(true)
    setError('')
    try {
      const response = await fetch(url, { method: 'POST', body: form }),
        result = await response.json()
      if (!result.success) throw new Error(result.error ?? 'Не вдалося додати файл')
      setRevision((v) => v + 1)
      setFile(undefined)
      key.current = crypto.randomUUID()
      if (input.current) input.current.value = ''
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Повторіть запит після відновлення зв’язку')
    } finally {
      setBusy(false)
    }
  }
  return (
    <details className="min-w-0 rounded border p-3">
      <summary className="min-h-11 cursor-pointer font-semibold">
        Вкладення документа ({rows.length})
      </summary>
      <div className="grid gap-2">
        {error && <p role="alert">{error}</p>}
        {rows.map((r) => (
          <a
            key={r.id}
            href={`${url}?file=${encodeURIComponent(r.id)}`}
            className="min-h-11 break-all rounded border p-2 underline"
          >
            {r.name} · {Math.ceil(r.size / 1024)} КБ
          </a>
        ))}
        {!rows.length && (
          <p className="text-sm text-muted-foreground">
            Додайте скан накладної, акта або підтвердження оплати.
          </p>
        )}
        {canUpload && (
          <>
            <Input
              ref={input}
              type="file"
              aria-label="Файл документа"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.csv,.xlsx"
              disabled={busy}
              onChange={(e) => {
                setFile(e.target.files?.[0])
                key.current = crypto.randomUUID()
              }}
            />
            <p className="text-sm text-muted-foreground">
              До 10 МБ. Вкладення зберігається разом з історією документа.
            </p>
            <Button type="button" disabled={busy || !file} onClick={upload}>
              {busy ? 'Завантаження…' : 'Додати вкладення'}
            </Button>
          </>
        )}
      </div>
    </details>
  )
}
