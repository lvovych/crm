'use client'
import { DocumentAttachments } from './DocumentAttachments'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  getWorkSubcontracts,
  postWorkSubcontract,
  saveWorkSubcontractDraft,
  transitionWorkSubcontract,
  reverseWorkSubcontract,
} from '../Actions/ledgerActions'
type Data = NonNullable<Awaited<ReturnType<typeof getWorkSubcontracts>>['data']>
export function WorkSubcontract({
  recordId,
  laborId,
  description,
}: {
  recordId: string
  laborId?: string
  description: string
}) {
  const [data, setData] = useState<Data>(),
    [error, setError] = useState(''),
    [supplier, setSupplier] = useState(''),
    [amount, setAmount] = useState(''),
    [number, setNumber] = useState(''),
    [dueDate, setDueDate] = useState(''),
    [taxMode, setTaxMode] = useState('NONE'),
    [taxRate, setTaxRate] = useState('0'),
    [quantity, setQuantity] = useState('1'),
    [editing, setEditing] = useState<{ id: string; expectedVersion: number }>(),
    [date, setDate] = useState(() =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date())
    ),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0)
  const keys = useRef(new Map<string, string>())
  useEffect(() => {
    let live = true
    if (laborId)
      getWorkSubcontracts(recordId, laborId).then((r) => {
        if (live) {
          setData(r.data)
          setError(r.error ?? '')
        }
      })
    return () => {
      live = false
    }
  }, [recordId, laborId, revision])
  if (!laborId) return <p>Збережіть наряд, щоб прив’язати документ підрядника до цієї роботи.</p>
  async function post(draft = false) {
    if (!supplier || !number || !amount) return
    if (
      !draft &&
      !window.confirm(
        `Зареєструвати послугу підрядника на ${amount} грн? Це створить борг постачальнику. Оплата та ціна клієнту не зміняться.`
      )
    )
      return
    const payload = {
        ...(draft ? editing : undefined),
        supplierId: supplier,
        externalNumber: number,
        effectiveAt: date,
        dueDate: dueDate || date,
        lines: [
          {
            serviceRecordId: recordId,
            serviceLaborId: laborId,
            description,
            quantity,
            unitCost: amount,
            taxMode,
            taxRate,
          },
        ],
      },
      fingerprint = JSON.stringify({ ...payload, draft })
    if (!keys.current.has(fingerprint)) keys.current.set(fingerprint, crypto.randomUUID())
    setBusy(true)
    setError('')
    try {
      const r = await (draft ? saveWorkSubcontractDraft : postWorkSubcontract)({
        ...payload,
        idempotencyKey: keys.current.get(fingerprint)!,
      })
      if (!r.success) setError(r.error ?? 'Помилка')
      else {
        setData(undefined)
        setRevision((v) => v + 1)
        setAmount('')
        setNumber('')
        setEditing(undefined)
        setQuantity('1')
      }
    } catch {
      setError('Немає відповіді сервера. Повторіть той самий запит.')
    } finally {
      setBusy(false)
    }
  }
  async function transition(line: Data['lines'][number], action: 'post' | 'cancel' | 'reverse') {
    const reason =
      action === 'reverse' ? window.prompt('Причина сторно (щонайменше 5 символів)') : undefined
    if (action === 'reverse' && (!reason || reason.trim().length < 5)) return
    if (
      !window.confirm(
        action === 'post'
          ? 'Провести акт і створити борг постачальнику?'
          : action === 'cancel'
            ? 'Скасувати чернетку?'
            : 'Сторнувати акт? Оплати залишаться авансом постачальнику.'
      )
    )
      return
    const payload = {
        id: line.documentId,
        expectedVersion: line.version,
        ...(action === 'reverse' ? { effectiveAt: date, reason } : {}),
      },
      hash = JSON.stringify({ action, ...payload })
    if (!keys.current.has(hash)) keys.current.set(hash, crypto.randomUUID())
    setBusy(true)
    setError('')
    try {
      const input = { ...payload, idempotencyKey: keys.current.get(hash) }
      const result =
        action === 'reverse'
          ? await reverseWorkSubcontract(input)
          : await transitionWorkSubcontract(input, action === 'cancel')
      if (!result.success) setError(result.error ?? 'Помилка')
      else {
        setData(undefined)
        setRevision((v) => v + 1)
      }
    } catch {
      setError('Немає відповіді сервера. Повторіть запит.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section
      onInput={(e) => e.stopPropagation()}
      className="col-span-full grid min-w-0 gap-3 rounded border p-3"
    >
      <h3 className="font-semibold">Послуги підрядника</h3>
      <p className="text-sm text-muted-foreground">
        Проведення послуги створює закупівельну собівартість і борг; механік і продажна ціна
        залишаються окремими.
      </p>
      {error && <p role="alert">{error}</p>}
      {data && data.executionType !== 'SUBCONTRACT' && (
        <p>
          Застосуйте зміни цієї роботи, дочекайтеся збереження наряду та відкрийте позицію знову.
        </p>
      )}
      {data?.lines.map((l) => (
        <div className="rounded border p-2" key={l.id}>
          <DocumentAttachments kind="subcontract" id={l.documentId} canUpload={data.canDraft} />
          {l.number} · {l.date}
          <br />
          {l.supplier} · до сплати {l.total} грн
          <p>
            Без податку {l.net} грн · податок {l.tax} грн
          </p>
          <p>
            {l.reversal
              ? 'Сторно'
              : l.reversed
                ? 'Сторновано'
                : l.status === 'DRAFT'
                  ? 'Чернетка'
                  : l.status === 'CANCELLED'
                    ? 'Скасовано'
                    : 'Проведено'}
          </p>
          {l.status === 'DRAFT' && l.lineCount === 1 && data.canDraft && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setEditing({ id: l.documentId, expectedVersion: l.version })
                setSupplier(l.supplierId)
                setNumber(l.externalNumber)
                setAmount(l.unitCost)
                setDate(l.date)
                setDueDate(l.dueDate)
                setTaxMode(l.taxMode)
                setTaxRate(l.taxRate)
                setQuantity(l.quantity)
              }}
            >
              Редагувати чернетку
            </Button>
          )}
          {l.status === 'DRAFT' && data.canPost && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={busy} onClick={() => transition(l, 'post')}>
                Провести акт
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy || Boolean(editing)}
                onClick={() => transition(l, 'cancel')}
              >
                Скасувати чернетку
              </Button>
            </div>
          )}
          {l.status === 'POSTED' && !l.reversed && !l.reversal && data.canReverse && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => transition(l, 'reverse')}
            >
              Сторнувати акт
            </Button>
          )}
        </div>
      ))}
      {data && (
        <>
          <label>
            Підрядник
            <select
              aria-label="Підрядник роботи"
              className="min-h-11 w-full rounded border bg-background p-2"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
            >
              <option value="">Виберіть постачальника послуг</option>
              {data.suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {!data.suppliers.length && (
            <p>
              Додайте постачальника з типом «Послуги» або «Товари й послуги» у довіднику складу.
            </p>
          )}
          <label>
            Номер акта підрядника
            <Input value={number} onChange={(e) => setNumber(e.target.value)} />
          </label>
          <label>
            Дата послуги
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            Сплатити до
            <Input
              type="date"
              value={dueDate || date}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </label>
          <label>
            Податок підрядника
            <select
              aria-label="Податок підрядника"
              className="min-h-11 w-full rounded border bg-background p-2"
              value={taxMode}
              onChange={(e) => {
                setTaxMode(e.target.value)
                if (e.target.value === 'NONE') setTaxRate('0')
              }}
            >
              <option value="NONE">Без податку</option>
              <option value="INCLUSIVE">Включений у суму</option>
              <option value="EXCLUSIVE">Додати до суми</option>
            </select>
          </label>
          {taxMode !== 'NONE' && (
            <label>
              Ставка податку, %
              <Input
                inputMode="decimal"
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value.replace(',', '.'))}
              />
            </label>
          )}
          {editing && <p>Редагування чернетки. Збережіть зміни перед проведенням.</p>}
          <label>
            Кількість послуг
            <Input
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value.replace(',', '.'))}
            />
          </label>
          <label>
            Закупівельна сума, грн
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(',', '.'))}
            />
          </label>
          <Button
            type="button"
            disabled={
              busy ||
              !data.canPost ||
              Boolean(editing) ||
              !supplier ||
              !number ||
              !amount ||
              data.executionType !== 'SUBCONTRACT'
            }
            onClick={() => post(false)}
          >
            Провести послугу підрядника
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={
              busy ||
              !data.canDraft ||
              !supplier ||
              !number ||
              !amount ||
              data.executionType !== 'SUBCONTRACT'
            }
            onClick={() => post(true)}
          >
            Зберегти чернетку акта
          </Button>
        </>
      )}
    </section>
  )
}
