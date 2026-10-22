'use client'
import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { getLedgerDirectory, getImportPreview, commitImportDraft } from '../Actions/ledgerActions'
import type { ImportMapping } from '../Lib/imports'
type Directory = NonNullable<Awaited<ReturnType<typeof getLedgerDirectory>>['data']>
type Preview = NonNullable<Awaited<ReturnType<typeof getImportPreview>>['data']>
export function ImportPanel() {
  const [directory, setDirectory] = useState<Directory>(),
    [supplier, setSupplier] = useState(''),
    [warehouse, setWarehouse] = useState(''),
    [file, setFile] = useState<File>(),
    [mapping, setMapping] = useState<ImportMapping>({
      article: 'Артикул',
      brand: 'Бренд',
      quantity: 'Кількість',
      unitPrice: 'Ціна',
    }),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [jobId, setJobId] = useState(''),
    [preview, setPreview] = useState<Preview>(),
    [page, setPage] = useState(1),
    [external, setExternal] = useState(''),
    [date, setDate] = useState(() =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date())
    )
  useEffect(() => {
    getLedgerDirectory().then((r) => {
      setDirectory(r.data)
      if (!r.success) setError(r.error ?? 'Помилка')
    })
  }, [])
  useEffect(() => {
    if (jobId)
      getImportPreview(jobId, page).then((r) => {
        setPreview(r.data)
        if (!r.success) setError(r.error ?? 'Помилка')
      })
  }, [jobId, page])
  async function upload() {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const form = new FormData()
      form.set('file', file)
      form.set('supplierId', supplier)
      form.set('mapping', JSON.stringify(mapping))
      const response = await fetch('/api/protected/stock-ledger/import', {
        method: 'POST',
        body: form,
      })
      const result = await response.json()
      if (!result.success) throw new Error(result.error ?? 'Помилка завантаження')
      setJobId(result.data.id)
      setPage(1)
      const p = await getImportPreview(result.data.id, 1)
      setPreview(p.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка')
    } finally {
      setBusy(false)
    }
  }
  async function commit() {
    setBusy(true)
    const result = await commitImportDraft({
      jobId,
      warehouseId: warehouse,
      effectiveAt: date,
      externalNumber: external,
      externalDate: date,
      dueDate: date,
    })
    setBusy(false)
    if (!result.success) setError(result.error ?? 'Помилка')
    else setError('Чернетку створено. Відкрийте її у «Надходженнях» для перевірки та проведення.')
  }
  return (
    <section className="grid gap-4">
      <h2 className="text-xl">Імпорт накладної CSV / XLSX</h2>
      <p>До 10 МБ і 10 000 рядків. Перший рядок — назви колонок. Імпорт створює лише чернетку.</p>
      {error && <p role="status">{error}</p>}
      <div className="grid gap-3 md:grid-cols-3">
        <label>
          Постачальник
          <select
            aria-label="Постачальник імпорту"
            className="min-h-11 w-full rounded border bg-background"
            value={supplier}
            onChange={(e) => {
              setSupplier(e.target.value)
              setJobId('')
              setPreview(undefined)
            }}
          >
            <option value="">Виберіть</option>
            {directory?.suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Склад
          <select
            aria-label="Склад імпорту"
            className="min-h-11 w-full rounded border bg-background"
            value={warehouse}
            onChange={(e) => setWarehouse(e.target.value)}
          >
            <option value="">Виберіть</option>
            {directory?.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Файл
          <Input
            type="file"
            accept=".csv,.xlsx"
            onChange={(e) => {
              setFile(e.target.files?.[0])
              setJobId('')
              setPreview(undefined)
            }}
          />
        </label>
      </div>
      <fieldset className="grid gap-3 rounded border p-3 md:grid-cols-4">
        <legend>Назви колонок у файлі</legend>
        {(
          [
            ['article', 'Артикул'],
            ['brand', 'Бренд'],
            ['quantity', 'Кількість'],
            ['unitPrice', 'Ціна'],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <Input
              value={mapping[key]}
              onChange={(e) => {
                setMapping((m) => ({ ...m, [key]: e.target.value }))
                setPreview(undefined)
                setJobId('')
              }}
            />
          </label>
        ))}
      </fieldset>
      <Button disabled={busy || !supplier || !file} onClick={upload}>
        Попередній перегляд
      </Button>
      {preview && (
        <>
          <strong>
            Рядків: {preview.total} · З помилками: {preview.errorCount}
          </strong>
          {preview.rows.map((r) => (
            <article key={r.row} className="grid gap-2 rounded border p-3 md:grid-cols-4">
              <span>
                Рядок {r.row} · {r.article} · {r.brand}
              </span>
              <span>{r.name}</span>
              <span>
                {r.quantity} × {r.unitPrice}
              </span>
              <span className={r.errors.length ? 'text-destructive' : 'text-muted-foreground'}>
                {r.errors.join('; ') || 'Перевірено'}
              </span>
            </article>
          ))}
          <div className="flex gap-2">
            <Button disabled={page === 1} onClick={() => setPage((v) => v - 1)}>
              Назад
            </Button>
            <Button disabled={page * 50 >= preview.total} onClick={() => setPage((v) => v + 1)}>
              Далі
            </Button>
          </div>
          {preview.errorCount > 0 ? (
            <p>
              Виправте всі помилки у файлі або відповідності каталогу й повторіть перегляд. Жоден
              рядок не буде пропущено мовчки.
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              <label>
                Номер накладної
                <Input value={external} onChange={(e) => setExternal(e.target.value)} />
              </label>
              <label>
                Дата
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <Button
                disabled={busy || !warehouse || !external || !!preview.documentId}
                onClick={commit}
              >
                Створити чернетку
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
