'use client'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { getAllocationSuggestion, allocatePaymentBatch } from '../Actions/ledgerActions'
import { D, moneyText } from '../Lib/amounts'
type Plan = NonNullable<Awaited<ReturnType<typeof getAllocationSuggestion>>['data']>
export function PaymentAllocationDialog({
  credits,
  onSaved,
}: {
  credits: { id: string; date: string; remaining: string }[]
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false),
    [credit, setCredit] = useState(''),
    [plan, setPlan] = useState<Plan>(),
    [amounts, setAmounts] = useState<Record<string, string>>({}),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [date, setDate] = useState(() =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date())
    ),
    [review, setReview] = useState(false)
  const keys = useRef(new Map<string, string>()),
    request = useRef(0)
  const total = Object.values(amounts).reduce(
    (s, a) => s.plus(/^\d+(\.\d{1,2})?$/.test(a) ? a : '0'),
    D(0)
  )
  async function load(id: string) {
    const n = ++request.current
    setCredit(id)
    setPlan(undefined)
    setReview(false)
    setError('')
    if (!id) return
    setBusy(true)
    try {
      const r = await getAllocationSuggestion(id)
      if (n !== request.current) return
      if (r.data) {
        setPlan(r.data)
        setAmounts(Object.fromEntries(r.data.lines.map((l) => [l.debitEntryId, l.amount])))
      } else setError(r.error ?? 'Не вдалося завантажити документи')
    } catch {
      setError('Немає зв’язку. Виберіть оплату повторно.')
    } finally {
      if (n === request.current) setBusy(false)
    }
  }
  function validate() {
    if (!plan) return false
    const selected = plan.lines.filter(
      (l) =>
        amounts[l.debitEntryId] !== '0.00' &&
        amounts[l.debitEntryId] !== '0' &&
        amounts[l.debitEntryId] !== ''
    )
    if (!selected.length) {
      setError('Вкажіть суму хоча б для одного документа')
      return false
    }
    if (
      selected.some(
        (l) =>
          !moneyText.safeParse(amounts[l.debitEntryId]).success ||
          D(amounts[l.debitEntryId]).gt(l.remaining)
      )
    ) {
      setError('Сума має бути додатною, до двох знаків і не більшою за борг документа')
      return false
    }
    if (total.gt(plan.available)) {
      setError('Сума перевищує доступний аванс')
      return false
    }
    if (date < plan.creditDate || selected.some((l) => date < l.date)) {
      setError('Дата рознесення не може передувати документам')
      return false
    }
    setError('')
    return true
  }
  async function apply() {
    if (!plan || !validate()) return
    const payload = {
        creditEntryId: credit,
        effectiveAt: date,
        lines: plan.lines
          .filter((l) => D(amounts[l.debitEntryId] || '0').gt(0))
          .map((l) => ({ debitEntryId: l.debitEntryId, amount: amounts[l.debitEntryId] })),
      },
      fingerprint = JSON.stringify(payload)
    if (!keys.current.has(fingerprint)) keys.current.set(fingerprint, crypto.randomUUID())
    setBusy(true)
    try {
      const r = await allocatePaymentBatch({
        ...payload,
        idempotencyKey: keys.current.get(fingerprint)!,
      })
      if (!r.success) {
        setError(r.error ?? 'Не вдалося рознести')
        return
      }
      setOpen(false)
      onSaved()
    } catch {
      setError('Немає відповіді. Повторіть підтвердження: повтор не створить дубль.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button
        variant="outline"
        disabled={!credits.length}
        onClick={() => {
          setOpen(true)
          setReview(false)
          setError('')
          setPlan(undefined)
          setCredit('')
        }}
      >
        Рознести на кілька документів
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!busy) setOpen(v)
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:max-w-full sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Рознесення оплати</DialogTitle>
            <DialogDescription>
              Спочатку — документи з найближчим строком оплати. Перевірте й за потреби змініть суми.
              Каса повторно не змінюється.
            </DialogDescription>
          </DialogHeader>
          <label>
            Оплата / аванс
            <select
              aria-label="Оплата для рознесення"
              className="min-h-11 w-full rounded border bg-background p-2"
              disabled={busy || review}
              value={credit}
              onChange={(e) => void load(e.target.value)}
            >
              <option value="">Виберіть оплату</option>
              {credits.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.date} · {c.remaining} грн
                </option>
              ))}
            </select>
          </label>
          {busy && !plan && <p role="status">Завантаження…</p>}
          {plan && (
            <>
              <label>
                Дата рознесення
                <Input
                  type="date"
                  value={date}
                  disabled={busy || review}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <div className="grid gap-2">
                {plan.lines.map((l) => (
                  <div
                    key={l.debitEntryId}
                    className="grid gap-2 rounded border p-3 sm:grid-cols-[1fr_9rem]"
                  >
                    <div className="min-w-0 break-words">
                      <strong>{l.label}</strong>
                      <p>
                        Залишок {l.remaining} грн · строк {l.dueDate ?? 'не вказаний'}
                      </p>
                    </div>
                    <label>
                      Рознести, грн
                      <Input
                        aria-label={`Рознести ${l.label}`}
                        inputMode="decimal"
                        disabled={busy || review}
                        value={amounts[l.debitEntryId] ?? ''}
                        onChange={(e) =>
                          setAmounts({
                            ...amounts,
                            [l.debitEntryId]: e.target.value.replace(',', '.'),
                          })
                        }
                      />
                    </label>
                  </div>
                ))}
              </div>
              <p>
                Разом: <strong>{total.toFixed(2)} грн</strong> · Залишиться аванс:{' '}
                {D(plan.available).minus(total).toFixed(2)} грн
              </p>
              {review ? (
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy} onClick={() => void apply()}>
                    Підтвердити рознесення
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={() => setReview(false)}>
                    Змінити суми
                  </Button>
                </div>
              ) : (
                <Button
                  disabled={busy}
                  onClick={() => {
                    if (validate()) setReview(true)
                  }}
                >
                  Перевірити рознесення
                </Button>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
