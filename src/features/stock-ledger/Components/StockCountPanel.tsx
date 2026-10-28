'use client'
import { useEffect, useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  getStockWarehouses,
  listStockCounts,
  getStockCount,
  stockCountCommand,
  searchLedgerProducts,
} from '../Actions/ledgerActions'
type Detail = NonNullable<Awaited<ReturnType<typeof getStockCount>>['data']>
type Rows = NonNullable<Awaited<ReturnType<typeof listStockCounts>>['data']>
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date())
export function StockCountPanel() {
  const [rows, setRows] = useState<Rows>(),
    [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]),
    [warehouseId, setWarehouse] = useState(''),
    [date, setDate] = useState(today),
    [reason, setReason] = useState('Планова інвентаризація'),
    [revision, setRevision] = useState(0),
    [page, setPage] = useState(1),
    [detail, setDetail] = useState<Detail>(),
    [counts, setCounts] = useState<Record<string, { countedQty: string; reason: string }>>({}),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [search, setSearch] = useState(''),
    [linePage, setLinePage] = useState(1),
    [excess, setExcess] = useState(false),
    [query, setQuery] = useState(''),
    [products, setProducts] = useState<
      NonNullable<Awaited<ReturnType<typeof searchLedgerProducts>>['data']>
    >([]),
    [productId, setProduct] = useState(''),
    [qty, setQty] = useState(''),
    [cost, setCost] = useState(''),
    [excessReason, setExcessReason] = useState('')
  const keys = useRef(new Map<string, string>())
  function key(payload: unknown) {
    const fingerprint = JSON.stringify(payload)
    if (!keys.current.has(fingerprint)) keys.current.set(fingerprint, crypto.randomUUID())
    return keys.current.get(fingerprint)!
  }
  useEffect(() => {
    getStockWarehouses().then((r) => setWarehouses(r.data ?? []))
  }, [])
  useEffect(() => {
    let live = true
    listStockCounts(page).then((r) => {
      if (live) {
        setRows(r.data)
        setError(r.error ?? '')
      }
    })
    return () => {
      live = false
    }
  }, [page, revision])
  useEffect(() => {
    const f = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', f)
    return () => window.removeEventListener('beforeunload', f)
  }, [dirty])
  useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      if (query)
        searchLedgerProducts(query).then((r) => {
          if (live) setProducts(r.data ?? [])
        })
    }, 180)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [query])
  async function open(id: string) {
    const r = await getStockCount(id)
    if (r.data) {
      setDetail(r.data)
      setCounts(
        Object.fromEntries(
          r.data.lines.map((l) => [l.id, { countedQty: l.countedQty ?? '', reason: l.reason }])
        )
      )
      setDirty(false)
    } else setError(r.error ?? 'Помилка')
  }
  async function command(
    op: 'start' | 'save' | 'post' | 'cancel',
    payload: Record<string, unknown>
  ) {
    setBusy(true)
    setError('')
    try {
      const r = await stockCountCommand(op, { ...payload, idempotencyKey: key([op, payload]) })
      if (r.data) {
        setRevision((v) => v + 1)
        await open(r.data.id)
        return true
      } else setError(r.error ?? 'Помилка')
    } catch {
      setError('Немає відповіді сервера. Повторіть той самий запит.')
    } finally {
      setBusy(false)
    }
    return false
  }
  const filtered =
    detail?.lines.filter((l) =>
      [l.inventoryPart.name, l.inventoryPart.partNumber, l.inventoryPart.brand.name]
        .join(' ')
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase())
    ) ?? []
  return (
    <section className="grid min-w-0 gap-4 [&_input]:min-h-11 [&_button]:min-h-11 [&_select]:min-h-11">
      <h2 className="text-xl">Інвентаризації</h2>
      <p>
        Почніть підрахунок, введіть фактичну кількість і поясніть розбіжності. Залишки зміняться
        лише після проведення.
      </p>
      <form
        className="grid gap-3 rounded border p-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          command('start', { warehouseId, effectiveAt: date, reason })
        }}
      >
        <label>
          Склад
          <select
            aria-label="Склад інвентаризації"
            required
            className="w-full rounded border bg-background p-2"
            value={warehouseId}
            onChange={(e) => setWarehouse(e.target.value)}
          >
            <option value="">Виберіть склад</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Дата
          <Input required type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          Підстава
          <Input
            required
            minLength={5}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <Button disabled={busy}>Почати підрахунок</Button>
      </form>
      {error && <p role="alert">{error}</p>}
      {rows?.rows.map((r) => (
        <Button
          className="h-auto justify-between whitespace-normal p-3 text-left"
          variant="outline"
          key={r.id}
          onClick={() => {
            setLinePage(1)
            setSearch('')
            open(r.id)
          }}
        >
          {r.warehouse.name} · {new Date(r.effectiveAt).toISOString().slice(0, 10)} ·{' '}
          {r.status === 'COUNTING'
            ? 'Підрахунок'
            : r.status === 'POSTED'
              ? 'Проведено'
              : 'Скасовано'}
        </Button>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          Назад
        </Button>
        <span>{page}</span>
        <Button disabled={!rows || page * 25 >= rows.total} onClick={() => setPage((p) => p + 1)}>
          Далі
        </Button>
      </div>
      <Dialog
        open={!!detail}
        onOpenChange={(v) => {
          if (!v && !busy && (!dirty || window.confirm('Вийти без збереження підрахунку?'))) {
            setDetail(undefined)
            setDirty(false)
          }
        }}
      >
        <DialogContent className="max-h-[95dvh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Інвентаризація · {detail?.warehouse.name}</DialogTitle>
          </DialogHeader>
          {error && <p role="alert">{error}</p>}
          {detail && (
            <>
              <p>
                {detail.adjustmentDocument
                  ? `Проведено: ${detail.adjustmentDocument.number}`
                  : 'Зміни кількості чи резервів після початку потребуватимуть нового підрахунку.'}
              </p>
              <Input
                aria-label="Пошук в інвентаризації"
                placeholder="Артикул, бренд або назва"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setLinePage(1)
                }}
              />
              {filtered.slice((linePage - 1) * 25, linePage * 25).map((l) => (
                <div key={l.id} className="grid gap-2 border-b py-3 sm:grid-cols-3">
                  <div>
                    <strong>{l.inventoryPart.name}</strong>
                    <p>
                      {l.inventoryPart.partNumber} · {l.inventoryPart.brand.name}
                    </p>
                    <p>
                      За обліком: {l.expectedQty} {l.inventoryPart.unit}
                    </p>
                  </div>
                  <label>
                    Фактично
                    <Input
                      disabled={detail.status !== 'COUNTING'}
                      inputMode="decimal"
                      value={counts[l.id]?.countedQty ?? ''}
                      onChange={(e) => {
                        setCounts((v) => ({
                          ...v,
                          [l.id]: { ...v[l.id], countedQty: e.target.value.replace(',', '.') },
                        }))
                        setDirty(true)
                      }}
                    />
                  </label>
                  <label>
                    Причина розбіжності
                    <Input
                      disabled={detail.status !== 'COUNTING'}
                      value={counts[l.id]?.reason ?? ''}
                      onChange={(e) => {
                        setCounts((v) => ({ ...v, [l.id]: { ...v[l.id], reason: e.target.value } }))
                        setDirty(true)
                      }}
                    />
                  </label>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2">
                <Button disabled={linePage === 1} onClick={() => setLinePage((p) => p - 1)}>
                  Попередні позиції
                </Button>
                <span>{linePage}</span>
                <Button
                  disabled={linePage * 25 >= filtered.length}
                  onClick={() => setLinePage((p) => p + 1)}
                >
                  Наступні позиції
                </Button>
              </div>
              {detail.status === 'COUNTING' && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={busy}
                    onClick={() =>
                      command('save', {
                        documentId: detail.id,
                        expectedVersion: detail.version,
                        lines: detail.lines
                          .filter((l) => counts[l.id]?.countedQty !== '')
                          .map((l) => ({
                            id: l.id,
                            inventoryPartId: l.inventoryPartId,
                            ...counts[l.id],
                          })),
                      })
                    }
                  >
                    Зберегти підрахунок
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy || dirty}
                    onClick={() => setExcess(true)}
                  >
                    Додати знайдений надлишок
                  </Button>
                  <Button
                    disabled={busy || dirty}
                    onClick={() => {
                      if (window.confirm('Провести розбіжності та змінити складські залишки?'))
                        command('post', { documentId: detail.id, expectedVersion: detail.version })
                    }}
                  >
                    Провести інвентаризацію
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm('Скасувати цей підрахунок без зміни складу?'))
                        command('cancel', {
                          documentId: detail.id,
                          expectedVersion: detail.version,
                        })
                    }}
                  >
                    Скасувати
                  </Button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={excess} onOpenChange={setExcess}>
        <DialogContent className="max-h-[95dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Знайдений товар без відомої партії</DialogTitle>
          </DialogHeader>
          {error && <p role="alert">{error}</p>}
          <form
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault()
              if (
                detail &&
                (await command('save', {
                  documentId: detail.id,
                  expectedVersion: detail.version,
                  lines: [
                    {
                      inventoryPartId: productId,
                      countedQty: qty,
                      confirmedUnitCost: cost,
                      reason: excessReason,
                    },
                  ],
                }))
              ) {
                setExcess(false)
                setQty('')
                setCost('')
              }
            }}
          >
            <label>
              Пошук товару
              <Input value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <label>
              Товар
              <select
                required
                className="w-full rounded border bg-background p-2"
                value={productId}
                onChange={(e) => setProduct(e.target.value)}
              >
                <option value="">Виберіть товар</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.partNumber} · {p.brand.name} · {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Кількість
              <Input
                required
                inputMode="decimal"
                value={qty}
                onChange={(e) => setQty(e.target.value.replace(',', '.'))}
              />
            </label>
            <label>
              Підтверджена собівартість одиниці, грн
              <Input
                required
                inputMode="decimal"
                value={cost}
                onChange={(e) => setCost(e.target.value.replace(',', '.'))}
              />
            </label>
            <label>
              Підстава оцінки та надлишку
              <Input
                required
                minLength={5}
                value={excessReason}
                onChange={(e) => setExcessReason(e.target.value)}
              />
            </label>
            <Button disabled={busy}>Додати до підрахунку</Button>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
