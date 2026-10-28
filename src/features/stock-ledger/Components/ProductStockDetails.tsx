'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { getProductStockDetails } from '../Actions/ledgerActions'
export function ProductStockDetails({ productId }: { productId: string }) {
  const [tab, setTab] = useState<'balances' | 'lots' | 'reservations'>('balances'),
    [page, setPage] = useState(1),
    [data, setData] = useState<Awaited<ReturnType<typeof getProductStockDetails>>['data']>(),
    [error, setError] = useState('')
  useEffect(() => {
    let live = true
    setData(undefined)
    setError('')
    getProductStockDetails({ productId, tab, page })
      .then((r) => {
        if (live) {
          setData(r.data)
          setError(r.error ?? '')
        }
      })
      .catch(() => {
        if (live) setError('Не вдалося завантажити дані. Повторіть спробу.')
      })
    return () => {
      live = false
    }
  }, [productId, tab, page])
  return (
    <section className="grid min-w-0 gap-3">
      <div className="flex flex-wrap gap-2" aria-label="Дані товару">
        {(['balances', 'lots', 'reservations'] as const).map((t) => (
          <Button
            key={t}
            variant={tab === t ? 'default' : 'outline'}
            aria-pressed={tab === t}
            onClick={() => {
              setTab(t)
              setPage(1)
            }}
          >
            {{ balances: 'Залишки по складах', lots: 'Партії', reservations: 'Резерви' }[t]}
          </Button>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p role="status">Завантаження…</p>}
      {data?.rows.map((r) => (
        <div key={r.id} className="grid gap-1 rounded border p-3">
          <strong>{r.label}</strong>
          <span className="break-words">{r.detail}</span>
          <span>
            Кількість: {r.quantity}
            {r.reserved !== null && ` · Резерв: ${r.reserved}`}
          </span>
          {r.recordId && (
            <a className="min-h-11 underline" href={`/sales/${r.recordId}`}>
              Відкрити наряд
            </a>
          )}
        </div>
      ))}
      {data?.total === 0 && <p>Записів немає.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          Попередні записи
        </Button>
        <span>
          {page} · Всього {data?.total ?? 0}
        </span>
        <Button disabled={!data || page * 25 >= data.total} onClick={() => setPage((p) => p + 1)}>
          Наступні записи
        </Button>
      </div>
    </section>
  )
}
