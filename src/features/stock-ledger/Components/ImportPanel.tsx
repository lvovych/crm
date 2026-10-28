'use client'
import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  getLedgerDirectory,
  getImportPreview,
  commitImportDraft,
  getLedgerImportTask,
  listRecentLedgerImports,
  retryLedgerImportTask,
} from '../Actions/ledgerActions'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { resolveLedgerImportRow, searchLedgerProducts } from '../Actions/ledgerActions'
import type { ImportMapping } from '../Lib/imports'
type Directory = NonNullable<Awaited<ReturnType<typeof getLedgerDirectory>>['data']>
type Preview = NonNullable<Awaited<ReturnType<typeof getImportPreview>>['data']>
export function ImportPanel() {
  const [recent, setRecent] = useState<
    NonNullable<Awaited<ReturnType<typeof listRecentLedgerImports>>['data']>
  >([])
  const [taskId, setTaskId] = useState(''),
    [task, setTask] = useState<Awaited<ReturnType<typeof getLedgerImportTask>>['data']>()
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
  const [resolving, setResolving] = useState<number>(),
    [query, setQuery] = useState(''),
    [matches, setMatches] = useState<
      NonNullable<Awaited<ReturnType<typeof searchLedgerProducts>>['data']>
    >([]),
    [resolveError, setResolveError] = useState('')
  const resolveKeys = useRef(new Map<string, string>())
  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      if (query)
        searchLedgerProducts(query).then((r) => {
          if (live) setMatches(r.data ?? [])
        })
    }, 180)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query])
  async function chooseProduct(inventoryPartId: string) {
    if (!preview || !resolving) return
    setBusy(true)
    setResolveError('')
    const payload = { jobId, row: resolving, inventoryPartId, expectedRevision: preview.revision },
      fingerprint = JSON.stringify(payload)
    if (!resolveKeys.current.has(fingerprint))
      resolveKeys.current.set(fingerprint, crypto.randomUUID())
    try {
      const r = await resolveLedgerImportRow({
        ...payload,
        idempotencyKey: resolveKeys.current.get(fingerprint)!,
      })
      if (!r.success) {
        setResolveError(r.error ?? 'Помилка зіставлення')
        return
      }
      const refreshed = await getImportPreview(jobId, page)
      setPreview(refreshed.data)
      setResolving(undefined)
    } catch {
      setResolveError('Немає відповіді сервера. Повторіть вибір товару.')
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    getLedgerDirectory().then((r) => {
      setDirectory(r.data)
      if (r.data) {
        const chosen = new URL(window.location.href).searchParams.get('importWarehouse')
        setWarehouse(
          r.data.warehouses.find((w) => w.id === chosen)?.id ??
            r.data.warehouses.find((w) => w.isDefault)?.id ??
            ''
        )
      }
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
  useEffect(() => {
    if (!taskId) return
    let active = true,
      timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const r = await getLedgerImportTask(taskId)
        if (!active) return
        if (!r.success || !r.data) {
          setError(r.error ?? 'Не вдалося перевірити імпорт')
          timer = setTimeout(poll, 5000)
          return
        }
        setTask(r.data)
        if (r.data.status === 'READY' && r.data.previewJobId) {
          setJobId(r.data.previewJobId)
          setPage(1)
        } else if (r.data.status !== 'FAILED') timer = setTimeout(poll, 1500)
      } catch {
        if (active) {
          setError('Немає зв’язку; статус буде перевірено повторно.')
          timer = setTimeout(poll, 5000)
        }
      }
    }
    void poll()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [taskId])
  useEffect(() => {
    const id = new URL(window.location.href).searchParams.get('importTask')
    if (id) setTaskId(id)
  }, [])
  useEffect(() => {
    if (taskId) {
      const url = new URL(window.location.href)
      url.searchParams.set('importTask', taskId)
      window.history.replaceState(null, '', url)
    }
    listRecentLedgerImports().then((r) => setRecent(r.data ?? []))
  }, [taskId, task?.status])
  useEffect(() => {
    if (warehouse) {
      const url = new URL(window.location.href)
      url.searchParams.set('importWarehouse', warehouse)
      window.history.replaceState(null, '', url)
    }
  }, [warehouse])
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
      setJobId('')
      setPreview(undefined)
      setTask(undefined)
      setTaskId(result.data.id)
      setPage(1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка')
    } finally {
      setBusy(false)
    }
  }
  async function commit() {
    setBusy(true)
    setError('')
    try {
      const result = await commitImportDraft({
        jobId,
        expectedRevision: preview?.revision,
        warehouseId: warehouse,
        effectiveAt: date,
        externalNumber: external,
        externalDate: date,
        dueDate: date,
      })
      if (!result.success) setError(result.error ?? 'Помилка')
      else setError('Чернетку створено. Відкрийте її у «Надходженнях» для перевірки та проведення.')
    } catch {
      setError('Немає відповіді сервера. Повторіть запит: імпорт не створить дубль.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="grid gap-4">
      <h2 className="text-xl">Імпорт накладної CSV / XLSX</h2>
      <p>До 10 МБ і 10 000 рядків. Перший рядок — назви колонок. Імпорт створює лише чернетку.</p>
      {error && <p role="status">{error}</p>}
      {task && (
        <div className="rounded border p-3">
          <p role="status">
            {task.status === 'QUEUED'
              ? 'Файл у черзі'
              : task.status === 'RUNNING'
                ? 'Обробка файла та зіставлення товарів…'
                : task.status === 'FAILED'
                  ? 'Помилка обробки'
                  : 'Файл перевірено'}{' '}
            · {task.sourceName}
          </p>
          {task.error && <p role="alert">{task.error}</p>}
          <a
            className="inline-flex min-h-11 items-center underline"
            href={`/api/protected/stock-ledger/import/${task.id}/original`}
          >
            Завантажити оригінал
          </a>
          {task.status === 'FAILED' && (
            <Button
              onClick={async () => {
                const r = await retryLedgerImportTask(task.id)
                if (r.success) {
                  setTaskId('')
                  setTimeout(() => setTaskId(task.id), 0)
                } else setError(r.error ?? 'Помилка')
              }}
            >
              Повторити обробку
            </Button>
          )}
        </div>
      )}
      <details>
        <summary className="cursor-pointer py-3">Останні імпорти — продовжити перевірку</summary>
        <div className="grid gap-2">
          {recent.map((r) => (
            <Button
              key={r.id}
              variant="outline"
              className="h-auto min-h-11 whitespace-normal justify-start"
              onClick={() => {
                setJobId('')
                setPreview(undefined)
                setTaskId(r.id)
              }}
            >
              {r.sourceName} · {new Date(r.createdAt).toLocaleDateString('uk-UA')}
            </Button>
          ))}
        </div>
      </details>
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
            ['name', 'Назва (необов’язково)'],
            ['unit', 'Одиниця (необов’язково)'],
            ['discount', 'Знижка сумою (необов’язково)'],
            ['lineTotal', 'Сума рядка (необов’язково)'],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <Input
              value={mapping[key] ?? ''}
              onChange={(e) => {
                setMapping((m) => ({ ...m, [key]: e.target.value || undefined }))
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
                {!preview.documentId && (
                  <Button
                    variant="outline"
                    className="mt-2 min-h-11 w-full"
                    onClick={() => {
                      setResolving(r.row)
                      setQuery(r.article)
                      setMatches([])
                      setResolveError('')
                    }}
                  >
                    {r.inventoryPartId ? 'Змінити відповідність' : 'Вибрати товар'}
                  </Button>
                )}
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
              Виберіть відповідний товар для невідомих позицій. Помилки чисел виправте у файлі й
              повторіть перегляд. Жоден рядок не буде пропущено мовчки.
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
      <Dialog
        open={resolving !== undefined}
        onOpenChange={(v) => {
          if (!v && !busy) setResolving(undefined)
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Товар для рядка {resolving}</DialogTitle>
          </DialogHeader>
          <p>
            Виберіть картку явно. Артикул і бренд у вихідному файлі залишаться в історії імпорту.
          </p>
          <Input
            aria-label="Пошук відповідності імпорту"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Артикул або назва"
          />
          {resolveError && <p role="alert">{resolveError}</p>}
          {!matches.length && <p>Змініть пошук, якщо відповідного товару немає у списку.</p>}
          {matches.map((p) => (
            <Button
              disabled={busy}
              variant="outline"
              className="h-auto min-h-11 whitespace-normal justify-start text-left"
              key={p.id}
              onClick={() => chooseProduct(p.id)}
            >
              {p.partNumber} · {p.brand.name} · {p.name}
            </Button>
          ))}
        </DialogContent>
      </Dialog>
    </section>
  )
}
