'use client'
import { ProductStockDetails } from './ProductStockDetails'
import { ProductCatalog } from './ProductCatalog'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getStockSummary, getStockHistory, getStockWarehouses } from '../Actions/ledgerActions'
type Summary = NonNullable<Awaited<ReturnType<typeof getStockSummary>>['data']>
type History = NonNullable<Awaited<ReturnType<typeof getStockHistory>>['data']>
const kinds: Record<string, string> = {
  RECEIPT: 'Прихід',
  ISSUE: 'Видача в наряд',
  WORK_ORDER_RETURN: 'Повернення з наряду',
  SUPPLIER_RETURN: 'Повернення постачальнику',
  TRANSFER: 'Переміщення',
  OPENING: 'Початковий залишок',
  ADJUSTMENT: 'Інвентаризація',
  REVERSAL: 'Сторно',
}
export function StockOverview({ costAllowed = false }: { costAllowed?: boolean }) {
  const [data, setData] = useState<Summary>(),
    [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]),
    [search, setSearch] = useState(''),
    [warehouseId, setWarehouse] = useState(''),
    [sort, setSort] = useState('name'),
    [onlyAvailable, setAvailable] = useState(false),
    [onlyDeficit, setDeficit] = useState(false),
    [includeArchived, setArchived] = useState(false),
    [brand, setBrand] = useState(''),
    [category, setCategory] = useState(''),
    [pageSize, setPageSize] = useState(25),
    [page, setPage] = useState(1),
    [error, setError] = useState(''),
    [selected, setSelected] = useState<Summary['rows'][number]>(),
    [history, setHistory] = useState<History>(),
    [historyPage, setHistoryPage] = useState(1),
    [from, setFrom] = useState(''),
    [through, setThrough] = useState(''),
    [ready, setReady] = useState(false),
    [revision, setRevision] = useState(0)
  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    setSearch((query.get('stockSearch') ?? '').slice(0, 100))
    setWarehouse(query.get('stockWarehouse') ?? '')
    setSort(query.get('stockSort') === 'available' ? 'available' : 'name')
    setAvailable(query.get('stockAvailable') === '1')
    setDeficit(query.get('stockDeficit') === '1')
    setArchived(query.get('stockArchived') === '1')
    setBrand(query.get('stockBrand') ?? '')
    setCategory(query.get('stockCategory') ?? '')
    setPageSize(
      [25, 50, 100].includes(Number(query.get('stockPageSize')))
        ? Number(query.get('stockPageSize'))
        : 25
    )
    const p = Number(query.get('stockPage') ?? '1')
    setPage(Number.isInteger(p) && p > 0 && p <= 100000 ? p : 1)
    setReady(true)
  }, [])
  useEffect(() => {
    if (!ready) return
    const url = new URL(window.location.href)
    for (const [key, value] of Object.entries({
      stockDeficit: onlyDeficit ? '1' : '',
      stockArchived: includeArchived ? '1' : '',
      stockBrand: brand,
      stockCategory: category,
      stockPageSize: String(pageSize),
      stockSearch: search,
      stockWarehouse: warehouseId,
      stockSort: sort,
      stockAvailable: onlyAvailable ? '1' : '',
      stockPage: String(page),
    })) {
      if (value) url.searchParams.set(key, value)
      else url.searchParams.delete(key)
    }
    window.history.replaceState(null, '', url)
  }, [
    ready,
    search,
    warehouseId,
    sort,
    onlyAvailable,
    page,
    onlyDeficit,
    includeArchived,
    brand,
    category,
    pageSize,
  ])
  useEffect(() => {
    getStockWarehouses().then((r) => {
      setWarehouses(r.data ?? [])
      if (r.error) setError(r.error)
    })
  }, [])
  useEffect(() => {
    if (!ready) return
    let live = true
    const timer = setTimeout(() => {
      getStockSummary({
        search,
        warehouseId,
        sort,
        onlyAvailable,
        page,
        onlyDeficit,
        includeArchived,
        brand,
        category,
        pageSize,
      }).then((r) => {
        if (live) {
          setData(r.data)
          setError(r.error ?? '')
        }
      })
    }, 200)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [
    ready,
    revision,
    search,
    warehouseId,
    sort,
    onlyAvailable,
    page,
    onlyDeficit,
    includeArchived,
    brand,
    category,
    pageSize,
  ])
  useEffect(() => {
    if (!selected) return
    let live = true
    getStockHistory({
      productId: selected.productId,
      warehouseId: selected.warehouseId,
      page: historyPage,
      from: from || undefined,
      through: through || undefined,
    }).then((r) => {
      if (live) {
        setHistory(r.data)
        setError(r.error ?? '')
      }
    })
    return () => {
      live = false
    }
  }, [selected, historyPage, from, through])
  if (!ready) return <p>Завантаження фільтрів…</p>
  return (
    <section className="grid min-w-0 gap-4 [&_button]:min-h-11 [&_input]:min-h-11 [&_select]:min-h-11">
      <h2 className="text-xl">Залишки за товаром і складом</h2>
      {data && (
        <p className="text-sm">
          За всім фільтром: на складі {data.totals.onHand} · резерв {data.totals.reserved} ·
          доступно {data.totals.available} · очікується {data.totals.expected}. Кількості різних
          одиниць не є грошовою оцінкою.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          aria-label="Пошук товарів у залишках"
          placeholder="Артикул, бренд або назва"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
        />
        <select
          aria-label="Склад"
          className="rounded border bg-background p-2"
          value={warehouseId}
          onChange={(e) => {
            setWarehouse(e.target.value)
            setPage(1)
          }}
        >
          <option value="">Усі склади</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Сортування"
          className="rounded border bg-background p-2"
          value={sort}
          onChange={(e) => {
            setSort(e.target.value)
            setPage(1)
          }}
        >
          <option value="name">За назвою</option>
          <option value="available">За доступною кількістю</option>
        </select>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={onlyAvailable}
            onChange={(e) => {
              setAvailable(e.target.checked)
              setPage(1)
            }}
          />{' '}
          Лише доступні
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          aria-label="Фільтр бренду"
          placeholder="Бренд"
          value={brand}
          onChange={(e) => {
            setBrand(e.target.value)
            setPage(1)
          }}
        />
        <Input
          aria-label="Фільтр категорії"
          placeholder="Категорія"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value)
            setPage(1)
          }}
        />
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={onlyDeficit}
            onChange={(e) => {
              setDeficit(e.target.checked)
              setPage(1)
            }}
          />
          Нижче мінімального запасу
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => {
              setArchived(e.target.checked)
              setPage(1)
            }}
          />
          Показати архівні
        </label>
      </div>
      <p className="text-sm text-muted-foreground">
        Очікується — підтверджені закупівлі, які ще не прийнято. Мінімальний запас із картки товару
        контролюється на основному складі.
      </p>
      {error && <p role="alert">{error}</p>}
      {data?.rows.map((r) => (
        <article
          key={r.productId + r.warehouseId}
          className="grid gap-3 rounded border p-3 md:grid-cols-5"
        >
          <div className="min-w-0 md:col-span-2">
            <strong className="break-words">{r.name}</strong>
            <p className="break-words text-sm">
              {r.article} · {r.brand} · {r.warehouse}
            </p>
          </div>
          <div>
            На складі: {r.onHand} {r.unit}
            <br />
            Резерв: {r.reserved}
          </div>
          <div>
            <strong>Доступно: {r.available}</strong>
            <p>Очікується: {r.expected}</p>
            <p>Мінімум: {r.minimum}</p>
            {r.deficit !== '0.000' && <p className="text-amber-600">До закупівлі: {r.deficit}</p>}
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setSelected(r)
              setHistory(undefined)
              setHistoryPage(1)
            }}
          >
            Історія рухів
          </Button>
        </article>
      ))}
      {data?.total === 0 && <p>За цими умовами залишків немає.</p>}
      <div className="flex flex-wrap items-center gap-3">
        <label>
          Рядків{' '}
          <select
            aria-label="Рядків на сторінці залишків"
            value={pageSize}
            className="rounded border bg-background p-2"
            onChange={(e) => {
              setPageSize(Number(e.target.value))
              setPage(1)
            }}
          >
            {[25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <Button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          Назад
        </Button>
        <span>
          Сторінка {page} · {data?.total ?? 0} записів
        </span>
        <Button
          disabled={!data || page * pageSize >= data.total}
          onClick={() => setPage((p) => p + 1)}
        >
          Далі
        </Button>
      </div>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(undefined)
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Картка товару · {selected?.name}</DialogTitle>
          </DialogHeader>
          {selected && costAllowed && (
            <ProductCatalog
              productId={selected.productId}
              onSaved={() => setRevision((v) => v + 1)}
            />
          )}
          {selected && <ProductStockDetails productId={selected.productId} />}
          <h3 className="font-semibold">Рух товару</h3>
          <div className="grid grid-cols-2 gap-2">
            <label>
              Від
              <Input
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value)
                  setHistoryPage(1)
                }}
              />
            </label>
            <label>
              До
              <Input
                type="date"
                value={through}
                onChange={(e) => {
                  setThrough(e.target.value)
                  setHistoryPage(1)
                }}
              />
            </label>
          </div>
          {error && <p role="alert">{error}</p>}
          {history?.rows.map((r) => (
            <div key={r.id} className="grid grid-cols-2 gap-2 border-b py-2">
              <span>
                {r.date}
                <br />
                {r.number}
                <br />
                {r.actor}
                {r.serviceRecordIds.map((id) => (
                  <a key={id} className="block min-h-11 underline" href={`/sales/${id}`}>
                    Наряд
                  </a>
                ))}
              </span>
              <span>
                {kinds[r.kind] ?? r.kind}
                <br />
                {r.quantity}
              </span>
            </div>
          ))}
          {history?.total === 0 && <p>Рухів за ці дати немає.</p>}
          <div className="flex gap-2">
            <Button disabled={historyPage === 1} onClick={() => setHistoryPage((p) => p - 1)}>
              Назад
            </Button>
            <span>{historyPage}</span>
            <Button
              disabled={!history || historyPage * 25 >= history.total}
              onClick={() => setHistoryPage((p) => p + 1)}
            >
              Далі
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
