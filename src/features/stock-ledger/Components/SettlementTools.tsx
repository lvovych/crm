'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  getLedgerStatement,
  reverseLedgerAllocation,
  reverseLedgerPayment,
  reverseLedgerReceipt,
} from '../Actions/ledgerActions'
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date())
export function StatementDownload({ partyId }: { partyId: string }) {
  const [date, setDate] = useState(today),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  async function download() {
    setBusy(true)
    setError('')
    const r = await getLedgerStatement({ partyId, through: date })
    setBusy(false)
    if (!r.data) {
      setError(r.error ?? 'Помилка')
      return
    }
    const url = URL.createObjectURL(
      new Blob(['\uFEFF' + r.data.csv], { type: 'text/csv;charset=utf-8' })
    )
    const a = document.createElement('a')
    a.href = url
    a.download = `supplier-statement-${date}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label>
        Звірка станом на
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <Button disabled={busy} variant="outline" onClick={download}>
        Завантажити звірку CSV
      </Button>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
export function SettlementReversal({
  paymentId,
  receiptId,
  allocations,
  onSaved,
}: {
  paymentId: string | null
  receiptId?: string
  allocations: { id: string; amount: string }[]
  onSaved: () => void
}) {
  const [operation, setOperation] = useState<{ id: string; payment: boolean; receipt?: boolean }>(),
    [reason, setReason] = useState(''),
    [date, setDate] = useState(today),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [key, setKey] = useState(() => crypto.randomUUID())
  function open(id: string, payment: boolean, receipt = false) {
    setOperation({ id, payment, receipt })
    setReason('')
    setError('')
    setKey(crypto.randomUUID())
  }
  async function submit() {
    if (!operation) return
    setBusy(true)
    setError('')
    const fn = operation.receipt
      ? reverseLedgerReceipt
      : operation.payment
        ? reverseLedgerPayment
        : reverseLedgerAllocation
    const r = await fn({ id: operation.id, effectiveAt: date, reason, idempotencyKey: key })
    setBusy(false)
    if (!r.success) setError(r.error ?? 'Помилка')
    else {
      setOperation(undefined)
      onSaved()
    }
  }
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {receiptId && (
          <Button variant="outline" onClick={() => open(receiptId, false, true)}>
            Сторнувати прихід
          </Button>
        )}
        {paymentId && (
          <Button variant="outline" onClick={() => open(paymentId, true)}>
            Сторнувати оплату
          </Button>
        )}
        {allocations.map((a) => (
          <Button key={a.id} variant="outline" onClick={() => open(a.id, false)}>
            Скасувати рознесення {a.amount} грн
          </Button>
        ))}
      </div>
      <Dialog open={!!operation} onOpenChange={(v) => !v && !busy && setOperation(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {operation?.receipt
                ? 'Сторнування приходу'
                : operation?.payment
                  ? 'Сторнування оплати'
                  : 'Скасування рознесення'}
            </DialogTitle>
          </DialogHeader>
          <p>
            {operation?.receipt
              ? 'Склад і нарахування боргу буде скасовано зворотним документом. Оплати залишаться авансом. Залежні рухи або резерви блокують сторно.'
              : operation?.payment
                ? 'Буде створено протилежний рух каси та скасовано рознесення цієї оплати. Доступно адміністратору.'
                : 'Борг і аванс відновляться. Руху каси не буде.'}
          </p>
          {error && <p role="alert">{error}</p>}
          <label>
            Дата
            <Input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value)
                setKey(crypto.randomUUID())
              }}
            />
          </label>
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
          <Button disabled={busy} onClick={submit}>
            Підтвердити
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
