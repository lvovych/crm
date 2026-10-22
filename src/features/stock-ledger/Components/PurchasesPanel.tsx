'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { listPurchaseOrders, purchaseOperation, saveReceipt } from '../Actions/ledgerActions'
import { D } from '../Lib/amounts'
type Order = NonNullable<Awaited<ReturnType<typeof listPurchaseOrders>>['data']>[number]
const labels: Record<string, string> = {
  DRAFT: 'Чернетка',
  CONFIRMED: 'Замовлено',
  PARTIALLY_RECEIVED: 'Частково отримано',
  RECEIVED: 'Отримано',
  CANCELLED: 'Залишок скасований',
}
export function PurchasesPanel() {
  const [rows, setRows] = useState<Order[]>([]),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<Order>(),
    [external, setExternal] = useState(''),
    [quantities, setQuantities] = useState<Record<string, string>>({}),
    [key, setKey] = useState(() => crypto.randomUUID())
  useEffect(() => {
    let active = true
    listPurchaseOrders(page).then((r) => {
      if (active) {
        setRows(r.data ?? [])
        setError(r.error ?? '')
      }
    })
    return () => {
      active = false
    }
  }, [page, revision])
  async function command(row: Order, op: 'confirm' | 'cancel') {
    if (op === 'cancel' && !window.confirm('Скасувати непоставлений залишок цього замовлення?'))
      return
    setBusy(true)
    const r = await purchaseOperation(op, {
      documentId: row.id,
      expectedVersion: row.version,
      idempotencyKey: `${row.id}:${row.version}:${op}`,
    })
    setBusy(false)
    if (!r.success) setError(r.error ?? 'Помилка')
    else setRevision((v) => v + 1)
  }
  async function receive() {
    if (!selected) return
    setBusy(true)
    setError('')
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date())
    const lines = selected.lines
      .filter((l) => quantities[l.id] && quantities[l.id] !== '0')
      .map((l) => ({
        inventoryPartId: l.inventoryPartId,
        purchaseOrderLineId: l.id,
        quantity: quantities[l.id],
        unitPrice: l.unitPrice,
      }))
    const r = await saveReceipt({
      idempotencyKey: key,
      supplierId: selected.supplierId,
      warehouseId: selected.warehouseId,
      effectiveAt: date,
      externalDate: date,
      dueDate: date,
      externalNumber: external,
      lines,
    })
    setBusy(false)
    if (!r.success) setError(r.error ?? 'Помилка')
    else {
      setSelected(undefined)
      setRevision((v) => v + 1)
      setError('Чернетку приходу створено. Відкрийте її у «Надходженнях», перевірте й проведіть.')
    }
  }
  return (
    <section className="grid gap-4">
      {error && <p role="status">{error}</p>}
      <p>
        Створюйте закупівлю з потреб наряду. Підтвердження записує замовлення в CRM, без надсилання
        постачальнику.
      </p>
      {rows.map((o) => (
        <article key={o.id} className="grid min-w-0 gap-3 rounded-lg border p-4">
          <div className="flex flex-wrap justify-between gap-3">
            <strong>
              {o.supplier} · {o.warehouse}
            </strong>
            <span>{labels[o.status]}</span>
          </div>
          {o.lines.map((l) => (
            <div key={l.id} className="grid gap-2 md:grid-cols-3">
              <span>
                {l.article} · {l.brand} · {l.name}
              </span>
              <span>
                Замовлено: {l.ordered} · Отримано: {l.received}
              </span>
              <span>Скасовано: {l.cancelled}</span>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {o.status === 'DRAFT' && (
              <Button disabled={busy} onClick={() => command(o, 'confirm')}>
                Підтвердити замовлення
              </Button>
            )}
            {['CONFIRMED', 'PARTIALLY_RECEIVED'].includes(o.status) && (
              <>
                <Button
                  onClick={() => {
                    setSelected(o)
                    setExternal('')
                    setQuantities(
                      Object.fromEntries(
                        o.lines.map((l) => [
                          l.id,
                          D(l.ordered).minus(l.received).minus(l.cancelled).toString(),
                        ])
                      )
                    )
                    setKey(crypto.randomUUID())
                  }}
                >
                  Прийняти частково
                </Button>
                <Button disabled={busy} variant="outline" onClick={() => command(o, 'cancel')}>
                  Скасувати залишок
                </Button>
              </>
            )}
          </div>
        </article>
      ))}
      {rows.length === 0 && <p>Замовлень ще немає.</p>}
      <div className="flex gap-3">
        <Button disabled={page === 1} onClick={() => setPage((v) => v - 1)}>
          Назад
        </Button>
        <Button disabled={rows.length < 25} onClick={() => setPage((v) => v + 1)}>
          Далі
        </Button>
      </div>
      <Dialog
        open={!!selected}
        onOpenChange={(v) => {
          if (!v && !busy) setSelected(undefined)
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Створити чернетку приходу</DialogTitle>
          </DialogHeader>
          {error && <p role="alert">{error}</p>}
          <label>
            Номер накладної
            <Input
              value={external}
              onChange={(e) => {
                setExternal(e.target.value)
                setKey(crypto.randomUUID())
              }}
            />
          </label>
          {selected?.lines.map((l) => (
            <label key={l.id}>
              {l.name}
              <Input
                aria-label={`Прийняти ${l.name}`}
                inputMode="decimal"
                value={quantities[l.id] ?? '0'}
                onChange={(e) => {
                  setQuantities((q) => ({ ...q, [l.id]: e.target.value }))
                  setKey(crypto.randomUUID())
                }}
              />
            </label>
          ))}
          <Button disabled={busy} onClick={receive}>
            Створити чернетку
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  )
}
