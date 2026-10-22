'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  getLedgerDocument,
  listLedgerDemands,
  purchaseOperation,
  stockOperation,
} from '../Actions/ledgerActions'
type Doc = NonNullable<Awaited<ReturnType<typeof getLedgerDocument>>['data']>
type Demand = NonNullable<Awaited<ReturnType<typeof listLedgerDemands>>['data']>[number]
type Allocation = {
  receiptLineId: string
  demandId: string
  quantity: string
  purchaseAllocationId?: string
}
export function ReceiptAllocation({
  documentId,
  onSaved,
}: {
  documentId: string
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false),
    [doc, setDoc] = useState<Doc>(),
    [demands, setDemands] = useState<Demand[]>([])
  const [search, setSearch] = useState(''),
    [rows, setRows] = useState<Allocation[]>([]),
    [line, setLine] = useState(''),
    [part, setPart] = useState(''),
    [qty, setQty] = useState('1')
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [key, setKey] = useState(() => crypto.randomUUID())
  useEffect(() => {
    if (!open) return
    let active = true
    const timer = setTimeout(() => {
      listLedgerDemands(search).then((r) => {
        if (active) {
          setDemands(r.data ?? [])
          if (r.error) setError(r.error)
        }
      })
    }, 180)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [open, search])
  async function show() {
    setBusy(true)
    setError('')
    const r = await getLedgerDocument(documentId)
    setBusy(false)
    if (!r.data) {
      setError(r.error ?? 'Документ не знайдений')
      return
    }
    setDoc(r.data)
    setRows(
      r.data.inventoryDocumentLine_document.flatMap((l) =>
        l.receiptDemandAllocation_receiptLine.map((a) => ({
          ...a,
          purchaseAllocationId: a.purchaseAllocationId ?? undefined,
        }))
      )
    )
    setLine('')
    setPart('')
    setKey(crypto.randomUUID())
    setOpen(true)
  }
  async function add() {
    const d = demands.find((d) => d.servicePartId === part)
    if (!d || !line) return
    setBusy(true)
    let id = d.demandId
    if (!id) {
      const r = await stockOperation('demand', {
        servicePartId: d.servicePartId,
        idempotencyKey: key + ':' + d.servicePartId,
      })
      if (!r.data) {
        setError(r.error ?? 'Не вдалося створити потребу')
        setBusy(false)
        return
      }
      id = r.data.id
    }
    setRows((r) => [...r, { receiptLineId: line, demandId: id!, quantity: qty }])
    setKey(crypto.randomUUID())
    setBusy(false)
  }
  async function save() {
    if (!doc) return
    setBusy(true)
    setError('')
    const r = await purchaseOperation('allocateReceipt', {
      documentId,
      expectedVersion: doc.version,
      allocations: rows,
      idempotencyKey: key,
    })
    setBusy(false)
    if (!r.success) setError(r.error ?? 'Помилка')
    else {
      setOpen(false)
      onSaved()
    }
  }
  return (
    <>
      <Button variant="outline" disabled={busy} onClick={show}>
        Розподілити між нарядами
      </Button>
      {error && !open && <p role="alert">{error}</p>}
      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Розподіл приходу</DialogTitle>
          </DialogHeader>
          <p>
            Розподілена кількість резервується після проведення. Решта залишається вільною на
            складі.
          </p>
          {error && <p role="alert">{error}</p>}
          <label>
            Товар
            <select
              className="min-h-11 w-full border bg-background"
              value={line}
              onChange={(e) => {
                setLine(e.target.value)
                setPart('')
              }}
            >
              <option value="">Виберіть рядок</option>
              {doc?.inventoryDocumentLine_document.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.snapshotName} · {l.quantity}
                </option>
              ))}
            </select>
          </label>
          <Input
            aria-label="Пошук наряду для розподілу"
            placeholder="Номер наряду"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label>
            Потреба
            <select
              className="min-h-11 w-full border bg-background"
              value={part}
              onChange={(e) => setPart(e.target.value)}
            >
              <option value="">Виберіть наряд</option>
              {demands
                .filter(
                  (d) =>
                    d.inventoryPartId ===
                    doc?.inventoryDocumentLine_document.find((l) => l.id === line)?.inventoryPartId
                )
                .map((d) => (
                  <option key={d.servicePartId} value={d.servicePartId}>
                    {d.job} · {d.name}
                  </option>
                ))}
            </select>
          </label>
          <Input
            aria-label="Кількість для наряду"
            inputMode="decimal"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
          <Button disabled={busy || !part || !line} onClick={add}>
            Додати розподіл
          </Button>
          {rows.map((r, i) => (
            <div
              key={`${r.receiptLineId}-${r.demandId}-${i}`}
              className="flex flex-wrap items-center justify-between gap-2 border p-2"
            >
              <span>
                {
                  doc?.inventoryDocumentLine_document.find((l) => l.id === r.receiptLineId)
                    ?.snapshotName
                }{' '}
                · {demands.find((d) => d.demandId === r.demandId)?.job ?? 'Наряд'} · {r.quantity}
              </span>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setRows(rows.filter((_, j) => i !== j))
                  setKey(crypto.randomUUID())
                }}
              >
                Прибрати
              </Button>
            </div>
          ))}
          <Button disabled={busy} onClick={save}>
            Зберегти розподіл
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
