'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  getLedgerDirectory,
  stockOperation,
  postStockCountAdjustment,
} from '../Actions/ledgerActions'
type Balance = {
  id: string
  lotId: string
  warehouseId: string
  version: number
  name: string
  onHand: string
}
export function StockActions({ balance, onSaved }: { balance: Balance; onSaved: () => void }) {
  const [op, setOp] = useState<'transfer' | 'supplierReturn' | 'adjust'>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [quantity, setQuantity] = useState('1'),
    [reason, setReason] = useState(''),
    [target, setTarget] = useState(''),
    [key, setKey] = useState(() => crypto.randomUUID())
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([])
  const labels = {
    transfer: 'Перемістити',
    supplierReturn: 'Повернути постачальнику',
    adjust: 'Звірити фактичну кількість',
  }
  async function open(action: typeof op) {
    setOp(action)
    setError('')
    setReason('')
    setTarget('')
    setQuantity(action === 'adjust' ? balance.onHand : '1')
    setKey(crypto.randomUUID())
    if (action === 'transfer') {
      const r = await getLedgerDirectory()
      setWarehouses(r.data?.warehouses ?? [])
      if (r.error) setError(r.error)
    }
  }
  async function submit() {
    if (!op) return
    setBusy(true)
    setError('')
    const effectiveAt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(
      new Date()
    )
    const payload = {
      idempotencyKey: key,
      effectiveAt,
      quantity,
      reason,
      lotId: balance.lotId,
      warehouseId: balance.warehouseId,
      sourceWarehouseId: balance.warehouseId,
      targetWarehouseId: target,
      balanceId: balance.id,
      expectedVersion: balance.version,
      countedQuantity: quantity,
    }
    const r =
      op === 'adjust' ? await postStockCountAdjustment(payload) : await stockOperation(op, payload)
    setBusy(false)
    if (!r.success) setError(r.error ?? 'Помилка операції')
    else {
      setOp(undefined)
      onSaved()
    }
  }
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(labels) as Array<keyof typeof labels>).map((a) => (
          <Button key={a} variant="outline" onClick={() => open(a)}>
            {labels[a]}
          </Button>
        ))}
      </div>
      <Dialog open={!!op} onOpenChange={(v) => !v && !busy && setOp(undefined)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{op && labels[op]}</DialogTitle>
          </DialogHeader>
          <strong>{balance.name}</strong>
          {error && <p role="alert">{error}</p>}
          <label>
            {op === 'adjust' ? 'Фактичний залишок партії' : 'Кількість'}
            <Input
              inputMode="decimal"
              value={quantity}
              onChange={(e) => {
                setQuantity(e.target.value)
                setKey(crypto.randomUUID())
              }}
            />
          </label>
          {op === 'transfer' ? (
            <label>
              Склад призначення
              <select
                className="min-h-11 w-full border bg-background"
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value)
                  setKey(crypto.randomUUID())
                }}
              >
                <option value="">Виберіть склад</option>
                {warehouses
                  .filter((w) => w.id !== balance.warehouseId)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
              </select>
            </label>
          ) : (
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
          <p>
            {op === 'supplierReturn'
              ? 'Операція зменшить склад і створить кредит постачальника. Повернення грошей реєструється окремо.'
              : op === 'adjust'
                ? 'Коригування доступне адміністратору. Вкажіть фактично перераховану кількість цієї партії.'
                : 'Переміщується лише вільна кількість зі збереженням партії та собівартості.'}
          </p>
          <Button disabled={busy} onClick={submit}>
            Підтвердити операцію
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
