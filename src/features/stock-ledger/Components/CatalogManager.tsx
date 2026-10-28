'use client'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getStockCatalogs, saveStockCatalog } from '../Actions/ledgerActions'
type Data = NonNullable<Awaited<ReturnType<typeof getStockCatalogs>>['data']>
export function CatalogManager() {
  const [data, setData] = useState<Data>(),
    [kind, setKind] = useState<'unit' | 'location'>('unit'),
    [id, setId] = useState(''),
    [version, setVersion] = useState(0),
    [code, setCode] = useState(''),
    [name, setName] = useState(''),
    [precision, setPrecision] = useState(0),
    [warehouse, setWarehouse] = useState(''),
    [archived, setArchived] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [revision, setRevision] = useState(0)
  const keys = useRef(new Map<string, string>())
  useEffect(() => {
    let live = true
    getStockCatalogs()
      .then((r) => {
        if (live) {
          setData(r.data)
          setMessage(r.error ?? '')
        }
      })
      .catch(() => {
        if (live) setMessage('Не вдалося завантажити довідники')
      })
    return () => {
      live = false
    }
  }, [revision])
  function clear() {
    setId('')
    setVersion(0)
    setCode('')
    setName('')
    setArchived(false)
    setPrecision(0)
  }
  async function save() {
    const payload = {
      ...(id ? { id, expectedVersion: version } : {}),
      code,
      name,
      precision,
      warehouseId: warehouse,
      archived,
    }
    const hash = kind + JSON.stringify(payload)
    if (!keys.current.has(hash)) keys.current.set(hash, crypto.randomUUID())
    setBusy(true)
    setMessage('')
    try {
      const r = await saveStockCatalog(kind, { ...payload, idempotencyKey: keys.current.get(hash) })
      if (!r.success) setMessage(r.error ?? 'Помилка')
      else {
        clear()
        setRevision((v) => v + 1)
      }
    } catch {
      setMessage('Немає відповіді сервера. Повторіть запит.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <details className="rounded border p-3">
      <summary className="cursor-pointer font-semibold">Одиниці виміру та місця зберігання</summary>
      <div className="mt-3 grid gap-3">
        <p>
          Для стандартних шт/pcs точність — 0, л/кг — 3. Для іншої фасовки створіть окремий товар.
          Місце — адреса зберігання; кількість обліковується за складом.
        </p>
        {message && <p role="alert">{message}</p>}
        <label>
          Довідник
          <select
            aria-label="Тип складського довідника"
            className="min-h-11 w-full rounded border bg-background p-2"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as 'unit' | 'location')
              clear()
            }}
          >
            <option value="unit">Одиниці виміру</option>
            <option value="location">Місця зберігання</option>
          </select>
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label>
            Код
            <Input value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <label>
            Назва
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        </div>
        {kind === 'unit' ? (
          <label>
            Знаків після крапки
            <Input
              type="number"
              min={0}
              max={3}
              value={precision}
              onChange={(e) => setPrecision(Number(e.target.value))}
            />
          </label>
        ) : (
          <label>
            Склад
            <select
              aria-label="Склад місця зберігання"
              className="min-h-11 w-full rounded border bg-background p-2"
              value={warehouse}
              onChange={(e) => setWarehouse(e.target.value)}
            >
              <option value="">Виберіть склад</option>
              {data?.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />{' '}
          Архівувати
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={busy || !code || !name || (kind === 'location' && !warehouse)}
            onClick={save}
          >
            {id ? 'Зберегти зміни' : 'Додати запис'}
          </Button>
          {id && (
            <Button type="button" variant="outline" onClick={clear}>
              Скасувати редагування
            </Button>
          )}
        </div>
        {kind === 'unit'
          ? data?.units.map((u) => (
              <div
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border p-2"
              >
                <span>
                  {u.code} · {u.name} · точність {u.precision}
                  {u.archivedAt ? ' · архів' : ''}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setId(u.id)
                    setVersion(u.version)
                    setCode(u.code)
                    setName(u.name)
                    setPrecision(u.precision)
                    setArchived(!!u.archivedAt)
                  }}
                >
                  Редагувати
                </Button>
              </div>
            ))
          : data?.locations.map((l) => (
              <div
                key={l.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border p-2"
              >
                <span>
                  {l.warehouse.name} / {l.code} · {l.name}
                  {l.archivedAt ? ' · архів' : ''}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setId(l.id)
                    setVersion(l.version)
                    setCode(l.code)
                    setName(l.name)
                    setWarehouse(l.warehouseId)
                    setArchived(!!l.archivedAt)
                  }}
                >
                  Редагувати
                </Button>
              </div>
            ))}
      </div>
    </details>
  )
}
