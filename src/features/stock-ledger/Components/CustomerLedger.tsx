'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { D } from '../Lib/amounts'
import { Input } from '@/components/ui/input'
import {
  getCustomerLedger,
  issueLedgerCustomerInvoice,
  customerLedgerAdjustment,
  customerLedgerPayment,
  customerLedgerAdvance,
} from '../Actions/ledgerActions'
type Data = NonNullable<Awaited<ReturnType<typeof getCustomerLedger>>['data']>
export function CustomerLedger({
  recordId,
  customerId,
  openFormSignal = 0,
}: {
  recordId: string
  customerId?: string | null
  openFormSignal?: number
}) {
  const [data, setData] = useState<Data>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [operation, setOperation] = useState('IN'),
    [amount, setAmount] = useState(''),
    [accountId, setAccount] = useState(''),
    [reason, setReason] = useState(''),
    [date, setDate] = useState(() =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date())
    )
  const router = useRouter()
  const keys = useRef(new Map<string, string>())
  const sectionRef = useRef<HTMLElement>(null),
    amountRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!openFormSignal) return
    sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    amountRef.current?.focus({ preventScroll: true })
  }, [openFormSignal])
  useEffect(() => {
    let live = true
    getCustomerLedger(recordId)
      .then((r) => {
        if (live) {
          setData(r.data)
          setError(r.error ?? '')
        }
      })
      .catch(() => {
        if (live) setError('Не вдалося завантажити розрахунки. Оновіть сторінку.')
      })
    return () => {
      live = false
    }
  }, [recordId, revision])
  async function submit(kind = operation, advance?: Data['advances'][number]) {
    if (!data || busy) return
    const isMoney = ['IN', 'OUT'].includes(kind)
    const advanceAmount = advance
      ? (D(advance.remaining).lt(data.debt) ? D(advance.remaining) : D(data.debt)).toFixed(2)
      : ''
    const payload =
      kind === 'ISSUE'
        ? { serviceRecordId: recordId, customerId, effectiveAt: date, dueDate: date }
        : kind === 'ADVANCE'
          ? {
              serviceRecordId: recordId,
              creditEntryId: advance?.id,
              amount: advanceAmount,
              effectiveAt: date,
              confirmed: true,
            }
          : {
              serviceRecordId: recordId,
              effectiveAt: date,
              amount: amount.replace(',', '.'),
              confirmed: true,
              ...(isMoney
                ? { accountId, direction: kind, method: 'manual', note: reason }
                : { kind, reason }),
            }
    const text =
      kind === 'ISSUE'
        ? 'Виставити рахунок? Платник і суми будуть зафіксовані.'
        : kind === 'ADVANCE'
          ? `Зарахувати ${advanceAmount} грн авансу на цей наряд? Каса не зміниться.`
          : `Провести ${labels[kind]} на ${amount} грн? ${isMoney ? 'Рух грошей буде записаний у вибрану касу/рахунок.' : 'Каса не зміниться.'}`
    if (!window.confirm(text)) return
    const fingerprint = JSON.stringify(payload)
    if (!keys.current.has(fingerprint)) keys.current.set(fingerprint, crypto.randomUUID())
    setBusy(true)
    setError('')
    try {
      const input = { ...payload, idempotencyKey: keys.current.get(fingerprint)! }
      const result = await (kind === 'ISSUE'
        ? issueLedgerCustomerInvoice(input)
        : kind === 'ADVANCE'
          ? customerLedgerAdvance(input)
          : isMoney
            ? customerLedgerPayment(input)
            : customerLedgerAdjustment(input))
      if (!result.success) setError(result.error ?? 'Помилка проведення')
      else {
        setRevision((v) => v + 1)
        router.refresh()
        setAmount('')
        setReason('')
      }
    } catch {
      setError('Немає відповіді сервера. Повторіть той самий запит без ризику дублювання.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section ref={sectionRef} className="grid min-w-0 gap-3" onInput={(e) => e.stopPropagation()}>
      <h3 className="font-semibold">Розрахунки за нарядом</h3>
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <p>
              Рахунок з коригуваннями: <strong>{data.total} грн</strong>
            </p>
            <p>
              До сплати: <strong>{data.debt} грн</strong>
            </p>
            <p>
              Невикористаний кредит коригувань: <strong>{data.credit} грн</strong>
            </p>
          </div>
          {!data.issued && (
            <>
              <p>
                Після виставлення суми й платник фіксуються. Виправлення проводяться окремими
                документами.
              </p>
              <Button
                type="button"
                disabled={busy || !customerId || !data.canPay}
                onClick={() => submit('ISSUE')}
              >
                Виставити рахунок
              </Button>
              {!customerId && <p>Спочатку виберіть клієнта та збережіть наряд.</p>}
            </>
          )}
          <>
            <label>
              Операція
              <select
                aria-label="Операція"
                className="min-h-11 w-full rounded border bg-background p-2"
                value={operation}
                onChange={(e) => setOperation(e.target.value)}
              >
                {Object.entries(labels)
                  .filter(([kind]) => data.issued || ['IN', 'OUT'].includes(kind))
                  .map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                Сума, грн
                <Input
                  ref={amountRef}
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <label>
                Дата
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
            </div>
            {['IN', 'OUT'].includes(operation) && (
              <label>
                Каса / рахунок
                <select
                  className="min-h-11 w-full rounded border bg-background p-2"
                  aria-label="Каса / рахунок"
                  value={accountId}
                  onChange={(e) => setAccount(e.target.value)}
                >
                  <option value="">Виберіть рахунок</option>
                  {data.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              {['CREDIT', 'DEBIT'].includes(operation)
                ? 'Причина коригування (обов’язково)'
                : 'Примітка'}
              <Input value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <Button
              type="button"
              onClick={() => submit()}
              disabled={
                busy ||
                !amount ||
                (['IN', 'OUT'].includes(operation) ? !data.canPay : !data.canAdjust) ||
                (['IN', 'OUT'].includes(operation) ? !accountId : reason.trim().length < 5)
              }
            >
              Провести операцію
            </Button>
            <p className="text-sm text-muted-foreground">
              Оплата погашає відкриті документи цього наряду. Переплата залишається авансом клієнта.
              Повернення товару не змінює рахунок або касу автоматично.
            </p>
          </>
          <p>
            Аванс / кредит клієнта за всіма нарядами: <strong>{data.advance} грн</strong>
          </p>
          {data.issued &&
            D(data.debt).gt(0) &&
            data.advances.map((credit) => (
              <Button
                key={credit.id}
                type="button"
                disabled={busy || !data.canPay}
                onClick={() => submit('ADVANCE', credit)}
              >
                Зарахувати аванс від {credit.date} (доступно {credit.remaining} грн)
              </Button>
            ))}
          {data.documents.map((d) => (
            <div key={d.id} className="rounded border p-3">
              <strong>{d.number}</strong> · {d.date}
              <br />
              {labels[d.kind] ?? 'Рахунок'}: {d.amount} грн · залишок {d.remaining} грн
              {d.reason && <p>{d.reason}</p>}
            </div>
          ))}
        </>
      )}
    </section>
  )
}
const labels: Record<string, string> = {
  IN: 'Оплата від клієнта',
  OUT: 'Повернення грошей клієнту',
  CREDIT: 'Зменшення рахунку',
  DEBIT: 'Донарахування',
}
