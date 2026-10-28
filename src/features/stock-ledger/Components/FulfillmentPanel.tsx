'use client'
import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  listLedgerDemands,
  getPurchaseSuggestion,
  getLedgerDirectory,
  stockOperation,
  purchaseOperation,
} from '../Actions/ledgerActions'
import { D } from '../Lib/amounts'
import { BulkFulfillment } from './BulkFulfillment'
type Demand = NonNullable<Awaited<ReturnType<typeof listLedgerDemands>>['data']>[number]
type Directory = NonNullable<Awaited<ReturnType<typeof getLedgerDirectory>>['data']>
export function FulfillmentPanel({
  serviceRecordId,
  servicePartId,
}: {
  serviceRecordId?: string
  servicePartId?: string
} = {}) {
  const [rows, setRows] = useState<Demand[]>([]),
    [directory, setDirectory] = useState<Directory>(),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [group, setGroup] = useState<'job' | 'supplier' | 'none'>('job'),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Demand>(),
    [warehouse, setWarehouse] = useState(''),
    [supplier, setSupplier] = useState(''),
    [quantity, setQuantity] = useState('1'),
    [price, setPrice] = useState('0'),
    [reason, setReason] = useState(''),
    [source, setSource] = useState(''),
    [op, setOp] = useState<
      'reserve' | 'issue' | 'return' | 'release' | 'purchase' | 'cancelDemand'
    >('reserve')
  const [key, setKey] = useState(() => crypto.randomUUID())
  useEffect(() => {
    let active = true
    Promise.all([
      listLedgerDemands(search, { serviceRecordId, servicePartId, page }),
      getLedgerDirectory(),
    ]).then(([d, w]) => {
      if (!active) return
      setRows(d.data ?? [])
      setDirectory(w.data)
      setError(d.error ?? w.error ?? '')
    })
    return () => {
      active = false
    }
  }, [search, revision, serviceRecordId, servicePartId, page])
  const open = (r: Demand, action: typeof op) => {
    setSelected(r)
    setOp(action)
    setQuantity('1')
    setSource('')
    setKey(crypto.randomUUID())
    setError('')
  }
  useEffect(() => {
    let live = true
    if (selected && op === 'purchase') {
      setSupplier(selected.preferredSupplier?.supplierId ?? '')
      setPrice('0')
      getPurchaseSuggestion(selected.inventoryPartId).then((r) => {
        if (live && r.data) {
          setSupplier(r.data.supplierId)
          setPrice(r.data.price)
        }
      })
    }
    return () => {
      live = false
    }
  }, [selected, op])
  async function submit() {
    if (!selected) return
    setBusy(true)
    setError('')
    try {
      let demandId = selected.demandId
      if (!demandId) {
        const result = await stockOperation('demand', {
          servicePartId: selected.servicePartId,
          idempotencyKey: key + ':demand',
        })
        if (!result.success || !result.data) throw new Error(result.error)
        demandId = result.data.id
      }
      const effectiveAt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(
        new Date()
      )
      const payload = {
        idempotencyKey: key,
        demandId,
        warehouseId: warehouse,
        quantity,
        effectiveAt,
        ...(op === 'return' ? { allocationId: source, reason } : {}),
        ...(op === 'cancelDemand' ? { reason } : {}),
        ...(op === 'release' ? { reservationId: source } : {}),
      }
      const result =
        op === 'purchase'
          ? await purchaseOperation('save', {
              idempotencyKey: key,
              supplierId: supplier,
              warehouseId: warehouse,
              lines: [
                {
                  inventoryPartId: selected.inventoryPartId,
                  quantity,
                  unitPrice: price,
                  allocations: [{ demandId, quantity }],
                },
              ],
            })
          : await stockOperation(op, payload)
      if (!result.success) throw new Error(result.error)
      setSelected(undefined)
      setRevision((r) => r + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка операції')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="grid min-w-0 gap-4">
      <Input
        aria-label="Пошук потреб за нарядом"
        placeholder="Наряд, номер авто або клієнт"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value)
          setPage(1)
        }}
      />
      {error && <p role="alert">{error}</p>}
      {rows.length === 0 && (
        <p>Потреб нових нарядів не знайдено. Історичні наряди потребують окремої звірки.</p>
      )}
      <BulkFulfillment
        rows={rows}
        directory={directory}
        onChanged={() => setRevision((r) => r + 1)}
      />
      <label>
        Групувати потреби
        <select
          aria-label="Групування потреб"
          className="min-h-11 rounded border bg-background p-2"
          value={group}
          onChange={(e) => setGroup(e.target.value as 'job' | 'supplier' | 'none')}
        >
          <option value="job">За нарядом</option>
          <option value="supplier">За постачальником</option>
          <option value="none">Без групування</option>
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          Попередні потреби
        </Button>
        <span>Сторінка {page}</span>
        <Button disabled={rows.length < 50} onClick={() => setPage((p) => p + 1)}>
          Наступні потреби
        </Button>
      </div>
      {(group === 'none'
        ? rows
        : [...rows].sort((a, b) =>
            (group === 'job' ? a.job : (a.preferredSupplier?.supplier.name ?? '')).localeCompare(
              group === 'job' ? b.job : (b.preferredSupplier?.supplier.name ?? '')
            )
          )
      ).map((r) => (
        <div
          key={r.servicePartId}
          className="grid min-w-0 gap-3 rounded-lg border p-3 lg:grid-cols-3"
        >
          <div className="break-words">
            <strong>{r.job}</strong>
            <p>
              {r.licensePlate} · {r.customerName}
            </p>
            <p>{r.name}</p>
            {r.preferredSupplier && (
              <p>
                {r.preferredSupplier.supplier.name} · поставка{' '}
                {r.preferredSupplier.leadTimeDays ?? '—'} днів
              </p>
            )}
          </div>
          <div>
            Потрібно: {r.quantity} · Видано: {r.issued} · Резерв: {r.reserved} · Очікується:{' '}
            {r.expected}
            <p>
              До закупівлі:{' '}
              {(D(r.quantity).minus(r.issued).minus(r.reserved).minus(r.expected).gt(0)
                ? D(r.quantity).minus(r.issued).minus(r.reserved).minus(r.expected)
                : D(0)
              ).toString()}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={r.stockOwnership === 'CUSTOMER'} onClick={() => open(r, 'reserve')}>
              Резерв
            </Button>
            <Button disabled={r.stockOwnership === 'CUSTOMER'} onClick={() => open(r, 'issue')}>
              Видати
            </Button>
            <Button variant="outline" onClick={() => open(r, 'return')}>
              Повернути
            </Button>
            <Button variant="outline" onClick={() => open(r, 'release')}>
              Зняти резерв
            </Button>
            <Button
              disabled={r.stockOwnership === 'CUSTOMER'}
              variant="outline"
              onClick={() => open(r, 'purchase')}
            >
              До закупівлі
            </Button>
            <Button
              disabled={!r.demandId}
              variant="outline"
              onClick={() => open(r, 'cancelDemand')}
            >
              Скасувати потребу
            </Button>
          </div>
        </div>
      ))}
      <Dialog
        open={!!selected}
        onOpenChange={(v) => {
          if (!v && !busy) setSelected(undefined)
        }}
      >
        <DialogContent
          onInput={(e) => e.stopPropagation()}
          className="max-h-[90dvh] overflow-y-auto [&_button]:min-h-11 [&_input]:min-h-11"
        >
          <DialogHeader>
            <DialogTitle>
              {
                {
                  cancelDemand: 'Скасувати складську потребу',
                  reserve: 'Зарезервувати',
                  issue: 'Видати в наряд',
                  return: 'Повернути з наряду',
                  release: 'Зняти резерв',
                  purchase: 'Замовити постачальнику',
                }[op]
              }
            </DialogTitle>
          </DialogHeader>
          <p>{selected?.name}</p>
          {error && <p role="alert">{error}</p>}
          <label hidden={op === 'cancelDemand'}>
            Кількість
            <Input
              inputMode="decimal"
              value={quantity}
              onChange={(e) => {
                setQuantity(e.target.value)
                setKey(crypto.randomUUID())
              }}
            />
          </label>
          <label hidden={op === 'cancelDemand'}>
            Склад
            <select
              className="min-h-11 w-full rounded border bg-background"
              value={warehouse}
              onChange={(e) => {
                setWarehouse(e.target.value)
                setKey(crypto.randomUUID())
              }}
            >
              <option value="">Виберіть склад</option>
              {directory?.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          {(op === 'return' || op === 'release') && (
            <label>
              Вихідна операція
              <select
                className="min-h-11 w-full rounded border bg-background"
                value={source}
                onChange={(e) => {
                  setSource(e.target.value)
                  setKey(crypto.randomUUID())
                }}
              >
                <option value="">Виберіть</option>
                {(op === 'return' ? selected?.issues : selected?.reservations)?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.quantity} · {r.id.slice(-6)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(op === 'return' || op === 'cancelDemand') && (
            <label>
              Причина
              <Input
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value)
                  setKey(crypto.randomUUID())
                }}
              />
            </label>
          )}
          {op === 'purchase' && (
            <>
              <label>
                Постачальник
                <select
                  className="min-h-11 w-full rounded border bg-background"
                  value={supplier}
                  onChange={(e) => {
                    setSupplier(e.target.value)
                    setKey(crypto.randomUUID())
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
                Погоджена ціна
                <Input
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => {
                    setPrice(e.target.value)
                    setKey(crypto.randomUUID())
                  }}
                />
              </label>
            </>
          )}
          <Button disabled={busy} onClick={submit}>
            Підтвердити
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  )
}
