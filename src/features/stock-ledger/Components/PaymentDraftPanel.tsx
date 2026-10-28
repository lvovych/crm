'use client'
import { DocumentAttachments } from './DocumentAttachments'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { paymentDraftCommand, listPaymentDrafts } from '../Actions/ledgerActions'
type Data = NonNullable<Awaited<ReturnType<typeof listPaymentDrafts>>['data']>
export function PaymentDraftPanel({
  partyId,
  accounts,
  onSaved,
  canDraft = true,
  canPost = true,
}: {
  partyId: string
  accounts: { id: string; name: string }[]
  canDraft?: boolean
  canPost?: boolean
  onSaved: () => void
}) {
  const [rows, setRows] = useState<Data>(),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0),
    [doc, setDoc] = useState<{ id: string; version: number }>(),
    [account, setAccount] = useState(''),
    [direction, setDirection] = useState('OUT'),
    [amount, setAmount] = useState(''),
    [date, setDate] = useState(() =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date())
    ),
    [method, setMethod] = useState('bank'),
    [note, setNote] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState('')
  const keys = useRef(new Map<string, string>()),
    fingerprint = JSON.stringify([account, direction, amount, date, method, note]),
    dirty = !!amount && saved !== fingerprint
  useEffect(() => {
    setDoc(undefined)
    setAmount('')
    setSaved('')
    setPage(1)
  }, [partyId])
  useEffect(() => {
    let live = true
    if (partyId)
      listPaymentDrafts(partyId, page).then((r) => {
        if (live) {
          setRows(r.data)
          setError(r.error ?? '')
        }
      })
    return () => {
      live = false
    }
  }, [partyId, page, revision])
  useEffect(() => {
    const f = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', f)
    return () => window.removeEventListener('beforeunload', f)
  }, [dirty])
  async function command(op: 'save' | 'post' | 'cancel') {
    if (
      op === 'post' &&
      !window.confirm(
        `Провести оплату ${amount} грн? Буде змінено касу та взаєморозрахунки. Банківський переказ не виконується.`
      )
    )
      return
    const payload =
        op === 'save'
          ? {
              documentId: doc?.id,
              expectedVersion: doc?.version,
              partyId,
              accountId: account,
              direction,
              amount,
              effectiveAt: date,
              method,
              note,
            }
          : { documentId: doc?.id, expectedVersion: doc?.version },
      key = JSON.stringify([op, payload])
    if (!keys.current.has(key)) keys.current.set(key, crypto.randomUUID())
    setBusy(true)
    setError('')
    try {
      const r = await paymentDraftCommand(op, {
        ...payload,
        idempotencyKey: keys.current.get(key)!,
      })
      if (!r.success || !r.data) {
        setError(r.error ?? 'Помилка')
        return
      }
      if (op === 'save' && 'version' in r.data && typeof r.data.version === 'number') {
        setDoc({ id: r.data.id, version: r.data.version })
        setSaved(fingerprint)
      } else {
        setDoc(undefined)
        setAmount('')
        setSaved('')
        onSaved()
      }
      setRevision((v) => v + 1)
    } catch {
      setError('Немає відповіді сервера. Повторіть цей самий запит.')
    } finally {
      setBusy(false)
    }
  }
  function open(row: Data['rows'][number]) {
    if (dirty && !window.confirm('Відкинути незбережені зміни оплати?')) return
    setDoc({ id: row.id, version: row.version })
    setAccount(row.accountId)
    setDirection(row.direction)
    setAmount(row.amount)
    setDate(row.effectiveAt)
    setMethod(row.method)
    setNote(row.note ?? '')
    setSaved(
      JSON.stringify([
        row.accountId,
        row.direction,
        row.amount,
        row.effectiveAt,
        row.method,
        row.note ?? '',
      ])
    )
  }
  return (
    <section className="grid gap-3 rounded border p-4 [&_input]:min-h-11 [&_button]:min-h-11 [&_select]:min-h-11">
      <h3 className="text-lg">Оплата: чернетка та проведення</h3>
      <p>
        Збереження чернетки не змінює касу чи борги. Проведення записує факт оплати, без
        банківського переказу.
      </p>
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
        <label>
          Каса / рахунок
          <select
            disabled={!canDraft}
            aria-label="Рахунок чернетки оплати"
            className="w-full rounded border bg-background p-2"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          >
            <option value="">Виберіть</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Напрям
          <select
            disabled={!canDraft}
            className="w-full rounded border bg-background p-2"
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
          >
            <option value="OUT">Виплата контрагенту</option>
            <option value="IN">Надходження від контрагента</option>
          </select>
        </label>
        <label>
          Сума оплати, грн
          <Input
            disabled={!canDraft}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(',', '.'))}
          />
        </label>
        <label>
          Дата оплати
          <Input
            disabled={!canDraft}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label>
          Спосіб оплати
          <select
            disabled={!canDraft}
            className="w-full rounded border bg-background p-2"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            <option value="bank">Банк</option>
            <option value="cash">Готівка</option>
            <option value="card">Картка</option>
            <option value="other">Інше</option>
          </select>
        </label>
        <label>
          Призначення
          <Input disabled={!canDraft} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <Button
          type="button"
          disabled={!canDraft || !account || !partyId || !amount}
          onClick={() => command('save')}
        >
          Зберегти чернетку оплати
        </Button>
        <Button type="button" disabled={!canPost || !doc || dirty} onClick={() => command('post')}>
          Провести збережену оплату
        </Button>
        {doc && canDraft && (
          <Button variant="outline" type="button" onClick={() => command('cancel')}>
            Скасувати чернетку оплати
          </Button>
        )}
      </fieldset>
      {doc && <DocumentAttachments kind="payment" id={doc.id} canUpload={canDraft} />}
      {doc && !dirty && <p role="status">Чернетку оплати збережено</p>}
      <h4>Непроведені оплати цього контрагента</h4>
      {rows?.rows.map((r) => (
        <Button
          key={r.id}
          variant="outline"
          className="h-auto whitespace-normal justify-start"
          onClick={() => open(r)}
        >
          {r.effectiveAt} · {r.direction === 'OUT' ? 'Виплата' : 'Надходження'} · {r.amount} грн
        </Button>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          Назад
        </Button>
        <span>{page}</span>
        <Button disabled={!rows || page * 25 >= rows.total} onClick={() => setPage((p) => p + 1)}>
          Далі
        </Button>
      </div>
    </section>
  )
}
