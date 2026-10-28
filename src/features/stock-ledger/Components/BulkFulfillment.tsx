'use client'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  bulkFulfillment,
  type listLedgerDemands,
  type getLedgerDirectory,
} from '../Actions/ledgerActions'
import { D } from '../Lib/amounts'
type Row = NonNullable<Awaited<ReturnType<typeof listLedgerDemands>>['data']>[number]
type Directory = NonNullable<Awaited<ReturnType<typeof getLedgerDirectory>>['data']>
export function BulkFulfillment({
  rows,
  directory,
  onChanged,
}: {
  rows: Row[]
  directory?: Directory
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false),
    [operation, setOperation] = useState<'reserve' | 'issue' | 'purchase'>('reserve'),
    [warehouse, setWarehouse] = useState(''),
    [supplier, setSupplier] = useState(''),
    [lines, setLines] = useState<
      Record<string, { selected: boolean; quantity: string; unitPrice: string }>
    >({}),
    [preview, setPreview] = useState<Awaited<ReturnType<typeof bulkFulfillment>>['data']>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const keys = useRef(new Map<string, string>()),
    eligible = rows.filter((r) => r.stockOwnership !== 'CUSTOMER').slice(0, 100)
  function reset(op: typeof operation) {
    setOperation(op)
    setPreview(undefined)
    setLines(
      Object.fromEntries(
        eligible.map((r) => {
          const n = D(r.quantity)
            .minus(r.issued)
            .minus(op === 'issue' ? 0 : r.reserved)
            .minus(op === 'purchase' ? r.expected : 0)
          return [
            r.servicePartId,
            { selected: n.gt(0), quantity: n.gt(0) ? n.toString() : '0', unitPrice: '0' },
          ]
        })
      )
    )
  }
  function change(
    id: string,
    value: Partial<{ selected: boolean; quantity: string; unitPrice: string }>
  ) {
    setLines((v) => ({ ...v, [id]: { ...v[id], ...value } }))
    setPreview(undefined)
  }
  async function submit(isPreview: boolean) {
    const payload = {
        operation,
        warehouseId: warehouse,
        supplierId: supplier || undefined,
        effectiveAt: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(
          new Date()
        ),
        lines: eligible
          .filter((r) => lines[r.servicePartId]?.selected)
          .map((r) => ({
            servicePartId: r.servicePartId,
            quantity: lines[r.servicePartId].quantity,
            unitPrice: lines[r.servicePartId].unitPrice,
          })),
      },
      fingerprint = JSON.stringify(payload)
    if (!keys.current.has(fingerprint)) keys.current.set(fingerprint, crypto.randomUUID())
    setBusy(true)
    setError('')
    try {
      const r = await bulkFulfillment(
        { ...payload, idempotencyKey: keys.current.get(fingerprint)! },
        isPreview
      )
      if (!r.success) {
        setError(r.error ?? 'Помилка')
        setPreview(undefined)
      } else if (isPreview) setPreview(r.data)
      else {
        setOpen(false)
        onChanged()
      }
    } catch {
      setError('Немає відповіді сервера. Повторіть той самий запит.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button
        variant="outline"
        disabled={!eligible.length}
        onClick={() => {
          reset('reserve')
          setError('')
          setOpen(true)
        }}
      >
        Обробити кілька позицій
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!busy) setOpen(v)
        }}
      >
        <DialogContent
          onInput={(e) => e.stopPropagation()}
          className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl"
        >
          <DialogHeader>
            <DialogTitle>Масова обробка потреб</DialogTitle>
          </DialogHeader>
          <p>
            Усі вибрані позиції виконуються разом. Якщо хоча б одну неможливо обробити, жодна не
            зміниться. Часткову кількість вкажіть явно.
          </p>
          {error && <p role="alert">{error}</p>}
          <label>
            Дія
            <select
              aria-label="Масова дія"
              className="min-h-11 w-full rounded border bg-background p-2"
              value={operation}
              onChange={(e) => reset(e.target.value as typeof operation)}
            >
              <option value="reserve">Зарезервувати</option>
              <option value="issue">Видати</option>
              <option value="purchase">Створити закупівлю</option>
            </select>
          </label>
          <label>
            Склад
            <select
              aria-label="Склад масової дії"
              className="min-h-11 w-full rounded border bg-background p-2"
              value={warehouse}
              onChange={(e) => {
                setWarehouse(e.target.value)
                setPreview(undefined)
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
          {operation === 'purchase' && (
            <label>
              Постачальник
              <select
                aria-label="Постачальник масової закупівлі"
                className="min-h-11 w-full rounded border bg-background p-2"
                value={supplier}
                onChange={(e) => {
                  setSupplier(e.target.value)
                  setPreview(undefined)
                }}
              >
                <option value="">Виберіть постачальника</option>
                {directory?.suppliers
                  .filter((s) => s.kind !== 'SERVICES')
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {eligible.map((r) => (
            <div className="grid gap-2 border-b py-2 sm:grid-cols-3" key={r.servicePartId}>
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  checked={lines[r.servicePartId]?.selected ?? false}
                  onChange={(e) => change(r.servicePartId, { selected: e.target.checked })}
                />
                <span>
                  {r.name}
                  <small className="block">{r.job}</small>
                </span>
              </label>
              <label>
                Кількість
                <Input
                  aria-label={`Масова кількість: ${r.name}`}
                  inputMode="decimal"
                  value={lines[r.servicePartId]?.quantity ?? ''}
                  onChange={(e) =>
                    change(r.servicePartId, { quantity: e.target.value.replace(',', '.') })
                  }
                />
              </label>
              {operation === 'purchase' && (
                <label>
                  Закупівельна ціна
                  <Input
                    inputMode="decimal"
                    value={lines[r.servicePartId]?.unitPrice ?? ''}
                    onChange={(e) =>
                      change(r.servicePartId, { unitPrice: e.target.value.replace(',', '.') })
                    }
                  />
                </label>
              )}
            </div>
          ))}
          {preview && (
            <div role="status" className="rounded border p-3">
              <strong>Перевірено {preview.rows.length} позицій</strong>
              {preview.rows.map((r) => (
                <p key={r.servicePartId}>
                  {r.name}: {r.quantity}
                </p>
              ))}
              <p>
                {operation === 'purchase'
                  ? 'Буде створено одну чернетку закупівлі.'
                  : 'Після підтвердження будуть змінені залишки або резерви.'}
              </p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={
                busy ||
                !warehouse ||
                !Object.values(lines).some((l) => l.selected) ||
                (operation === 'purchase' && !supplier)
              }
              onClick={() => submit(true)}
            >
              Перевірити вибрані позиції
            </Button>
            <Button disabled={busy || !preview} onClick={() => submit(false)}>
              Підтвердити всі позиції
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
