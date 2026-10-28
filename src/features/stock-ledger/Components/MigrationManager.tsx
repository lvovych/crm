'use client'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { previewLedgerMigration, commitLedgerMigration } from '../Actions/ledgerActions'
export function MigrationManager() {
  const [manifest, setManifest] = useState<unknown>(),
    [preview, setPreview] =
      useState<NonNullable<Awaited<ReturnType<typeof previewLedgerMigration>>['data']>>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [done, setDone] = useState(false)
  const key = useRef(crypto.randomUUID())
  async function run(commit = false) {
    if (
      commit &&
      (!preview ||
        !confirmed ||
        !window.confirm(
          'Застосувати затверджений пакет? Якщо activate=true, нові наряди перейдуть на складський та фінансовий облік.'
        ))
    )
      return
    setBusy(true)
    setError('')
    try {
      if (commit) {
        const r = await commitLedgerMigration({
          manifest,
          checksum: preview!.checksum,
          idempotencyKey: key.current,
          confirmed: true,
        })
        if (!r.success) throw new Error(r.error)
        setDone(true)
      } else {
        const r = await previewLedgerMigration(manifest)
        if (!r.success || !r.data) throw new Error(r.error)
        setPreview(r.data)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Немає відповіді сервера. Повторіть запит.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <details className="rounded border p-3">
      <summary className="min-h-11 cursor-pointer font-semibold">Перехід зі старого обліку</summary>
      <div className="grid gap-3">
        <p>
          Завантажте JSON-пакет із затвердженими залишками, боргами та звіркою активних нарядів.
          Попередня перевірка виконує всі команди й відкочує зміни.
        </p>
        <Input
          type="file"
          accept=".json"
          aria-label="Пакет міграції"
          disabled={busy}
          onChange={async (e) => {
            setPreview(undefined)
            setDone(false)
            setConfirmed(false)
            setManifest(undefined)
            setError('')
            key.current = crypto.randomUUID()
            const file = e.target.files?.[0]
            if (!file) return
            try {
              if (file.size > 1024 * 1024) throw new Error('Пакет перевищує 1 МБ')
              setManifest(JSON.parse(await file.text()))
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Некоректний JSON')
            }
          }}
        />
        {error && <p role="alert">{error}</p>}
        <Button type="button" disabled={busy || !manifest || done} onClick={() => run()}>
          Перевірити без збереження
        </Button>
        {preview && (
          <>
            <p className="break-all">Контрольна сума: {preview.checksum}</p>
            <details>
              <summary>Зіставлення документів</summary>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">
                {JSON.stringify(preview.result, null, 2)}
              </pre>
            </details>
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              Залишки, борги, дата та ролі затверджені; записи зупинено; логічний бекап перевірено.
            </label>
            <Button type="button" disabled={busy || !confirmed || done} onClick={() => run(true)}>
              Застосувати пакет
            </Button>
          </>
        )}
        {done && <p role="status">Пакет застосовано. Повторний запит не створить дублікати.</p>}
      </div>
    </details>
  )
}
