'use client'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getProductCatalog, saveStockCatalog } from '../Actions/ledgerActions'
type Data = NonNullable<Awaited<ReturnType<typeof getProductCatalog>>['data']>
export function ProductCatalog({
  productId,
  onSaved,
}: {
  productId: string
  onSaved?: () => void
}) {
  const [data, setData] = useState<Data>(),
    [revision, setRevision] = useState(0),
    [unit, setUnit] = useState(''),
    [location, setLocation] = useState(''),
    [tracking, setTracking] = useState('STOCK'),
    [supplier, setSupplier] = useState(''),
    [article, setArticle] = useState(''),
    [price, setPrice] = useState(''),
    [days, setDays] = useState(''),
    [preferred, setPreferred] = useState(false),
    [archived, setArchived] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('')
  const keys = useRef(new Map<string, string>())
  useEffect(() => {
    let live = true
    getProductCatalog(productId)
      .then((r) => {
        if (!live) return
        setData(r.data)
        setMessage(r.error ?? '')
        if (r.data) {
          setUnit(r.data.product.unitId ?? '')
          setLocation(r.data.product.locationId ?? '')
          setTracking(r.data.product.trackingMode)
        }
      })
      .catch(() => {
        if (live) setMessage('Не вдалося завантажити картку')
      })
    return () => {
      live = false
    }
  }, [productId, revision])
  function chooseSupplier(id: string) {
    setSupplier(id)
    const m = data?.mappings.find((m) => m.supplierId === id)
    setArticle(m?.supplierArticle ?? '')
    setPrice(m?.lastQuotedPrice ?? '')
    setDays(m?.leadTimeDays?.toString() ?? '')
    setPreferred(m?.preferred ?? false)
    setArchived(!!m?.archivedAt)
  }
  async function save(kind: 'product' | 'supplierProduct') {
    if (!data) return
    const payload =
      kind === 'product'
        ? {
            inventoryPartId: productId,
            expectedUpdatedAt: data.product.updatedAt,
            unitId: unit || null,
            locationId: location || null,
            trackingMode: tracking,
          }
        : {
            inventoryPartId: productId,
            supplierId: supplier,
            expectedVersion: data.mappings.find((m) => m.supplierId === supplier)?.version ?? 0,
            supplierArticle: article,
            lastQuotedPrice: price ? price.replace(',', '.') : null,
            leadTimeDays: days ? Number(days) : null,
            preferred,
            archived,
          }
    const fingerprint = kind + JSON.stringify(payload)
    if (!keys.current.has(fingerprint)) keys.current.set(fingerprint, crypto.randomUUID())
    setBusy(true)
    setMessage('')
    try {
      const r = await saveStockCatalog(kind, {
        ...payload,
        idempotencyKey: keys.current.get(fingerprint),
      })
      if (!r.success) setMessage(r.error ?? 'Помилка')
      else {
        setRevision((v) => v + 1)
        setMessage('Збережено')
        onSaved?.()
      }
    } catch {
      setMessage('Немає відповіді сервера. Повторіть запит.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <details className="rounded border p-3">
      <summary className="cursor-pointer font-semibold">
        Постачальники, одиниця та місце зберігання
      </summary>
      <div className="mt-3 grid gap-3">
        {message && <p role="alert">{message}</p>}
        {data && (
          <>
            <p>
              Одиниця: {data.product.unit ?? 'pcs'} ·{' '}
              {data.product.trackingMode === 'STOCK'
                ? 'Складський товар'
                : 'Без складського обліку'}
            </p>
            <p>
              Місце:{' '}
              {data.locations.find((l) => l.id === data.product.locationId)?.code ?? 'не вказано'}
            </p>
            {data.isAdmin && (
              <>
                <label>
                  Одиниця товару
                  <select
                    aria-label="Одиниця товару"
                    className="min-h-11 w-full rounded border bg-background p-2"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                  >
                    <option value="">Поточна текстова одиниця: {data.product.unit ?? 'pcs'}</option>
                    {data.units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.code}), точність {u.precision}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Місце зберігання
                  <select
                    aria-label="Місце зберігання товару"
                    className="min-h-11 w-full rounded border bg-background p-2"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                  >
                    <option value="">Не вказано</option>
                    {data.locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.warehouse.name} / {l.code} · {l.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Складський облік
                  <select
                    aria-label="Спосіб обліку товару"
                    className="min-h-11 w-full rounded border bg-background p-2"
                    value={tracking}
                    onChange={(e) => setTracking(e.target.value)}
                  >
                    <option value="STOCK">Вести залишки та видачу</option>
                    <option value="NON_STOCK">Без власного складського обліку</option>
                  </select>
                </label>
                <p className="text-sm text-muted-foreground">
                  Одиницю й спосіб обліку можна змінити лише до появи рухів або відкритих
                  зобов’язань. Місце — адреса для пошуку, а не окремий кількісний залишок.
                </p>
                <Button type="button" disabled={busy} onClick={() => save('product')}>
                  Зберегти параметри товару
                </Button>
              </>
            )}
            <h4 className="font-semibold">Пропозиції постачальників</h4>
            <p className="text-sm text-muted-foreground">
              Довідкова ціна не змінює проведені накладні або собівартість. Відповідність артикулу
              використовується при наступному імпорті.
            </p>
            {!data.mappings.length && <p>Пропозицій ще немає.</p>}
            {data.mappings.map((m) => (
              <div key={m.id} className="rounded border p-2">
                <strong>{m.supplier.name}</strong> {m.preferred ? '· основний' : ''}{' '}
                {m.archivedAt ? '· архів' : ''}
                <p>
                  Артикул: {m.supplierArticle ?? '—'} · {m.lastQuotedPrice ?? '—'} грн ·{' '}
                  {m.leadTimeDays ?? '—'} днів
                </p>
                {data.isAdmin && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => chooseSupplier(m.supplierId)}
                  >
                    Редагувати пропозицію
                  </Button>
                )}
              </div>
            ))}
            {data.isAdmin && (
              <>
                <label>
                  Постачальник товару
                  <select
                    aria-label="Постачальник товару"
                    className="min-h-11 w-full rounded border bg-background p-2"
                    value={supplier}
                    onChange={(e) => chooseSupplier(e.target.value)}
                  >
                    <option value="">Виберіть постачальника</option>
                    {data.suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Артикул постачальника
                  <Input value={article} onChange={(e) => setArticle(e.target.value)} />
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label>
                    Ціна пропозиції, грн
                    <Input
                      inputMode="decimal"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                    />
                  </label>
                  <label>
                    Строк поставки, днів
                    <Input
                      type="number"
                      min={0}
                      max={365}
                      value={days}
                      onChange={(e) => setDays(e.target.value)}
                    />
                  </label>
                </div>
                <label>
                  <input
                    type="checkbox"
                    checked={preferred}
                    onChange={(e) => setPreferred(e.target.checked)}
                  />{' '}
                  Основний постачальник
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={archived}
                    onChange={(e) => setArchived(e.target.checked)}
                  />{' '}
                  Архівувати пропозицію
                </label>
                <Button
                  type="button"
                  disabled={busy || !supplier}
                  onClick={() => save('supplierProduct')}
                >
                  Зберегти пропозицію
                </Button>
              </>
            )}
          </>
        )}
      </div>
    </details>
  )
}
