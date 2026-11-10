'use client'
import { useState, useTransition, useRef, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AccountSelect } from '@/features/finance/AccountSelect'
import { recordSettlement, type settlementReport, type settlementAccess } from './actions'
import {
  suggestedDistribution,
  workshopDay,
  isCredit,
  kopecks,
  hryvnia,
  splitPayment,
} from './amounts'
type AccountData = NonNullable<Awaited<ReturnType<typeof settlementReport>>['data']>[number]
type Rights = Awaited<ReturnType<typeof settlementAccess>>
const kinds: Record<string, string> = {
  receipt: 'Накладна',
  payment: 'Оплата',
  opening_credit: 'Початковий аванс',
  opening_debt: 'Початковий борг',
}
const box = 'rounded-md border bg-background px-3 py-2'
const button = 'rounded-md bg-primary px-4 py-2 text-primary-foreground'
function Operation({
  supplier,
  build,
  children,
  label,
  onSaved,
}: {
  supplier: string
  build: (f: FormData) => unknown
  children?: ReactNode
  label: string
  onSaved?: () => void
}) {
  const router = useRouter(),
    [pending, start] = useTransition(),
    [message, setMessage] = useState(''),
    key = useRef('')
  return (
    <form
      className="flex flex-wrap items-end gap-3 py-2"
      onSubmit={(e) => {
        e.preventDefault()
        const form = e.currentTarget
        const data = new FormData(form)
        key.current ||= crypto.randomUUID()
        start(async () => {
          setMessage('')
          try {
            const result = await recordSettlement(supplier, key.current, build(data))
            if (!result.success) {
              setMessage(result.error || 'Помилка')
              return
            }
            key.current = ''
            form.reset()
            onSaved?.()
            setMessage('Збережено')
            router.refresh()
          } catch {
            setMessage('Перевірте результат та повторіть за потреби.')
          }
        })
      }}
    >
      {children}
      <button className={button} disabled={pending}>
        {label}
      </button>
      <span role="status">{message}</span>
    </form>
  )
}
const field = (f: FormData, k: string) => String(f.get(k) || '')
function Amount({
  name = 'amount',
  value,
  zero = false,
  onInput,
}: {
  name?: string
  value?: string
  zero?: boolean
  onInput?: (v: string) => void
}) {
  return (
    <label>
      Сума, грн
      <input
        className={'block ' + box}
        name={name}
        type="number"
        required
        step=".01"
        min={zero ? '0' : '.01'}
        defaultValue={value}
        onChange={(e) => onInput?.(e.target.value)}
      />
    </label>
  )
}
function DateField() {
  return (
    <label>
      Дата операції
      <input
        className={'block ' + box}
        type="date"
        name="date"
        required
        defaultValue={workshopDay()}
        max={workshopDay()}
      />
    </label>
  )
}
function PaymentForm({
  supplierId,
  selected,
}: {
  supplierId: string
  selected?: AccountData['rows'][number]
}) {
  const [typed, setTyped] = useState('')
  const split =
    selected && /^\d{1,18}(\.\d{1,2})?$/.test(typed)
      ? splitPayment(kopecks(typed), kopecks(selected.open))
      : null
  return (
    <section className="rounded border p-4">
      <h2 className="font-semibold">
        {selected
          ? 'Оплата за накладною № ' + selected.reference
          : 'Зареєструвати платіж постачальнику'}
      </h2>
      <Operation
        supplier={supplierId}
        onSaved={() => setTyped('')}
        label="Зареєструвати оплату"
        build={(f) => ({
          op: 'payment',
          moneyAccountId: field(f, 'moneyAccountId') || undefined,
          target: selected?.id,
          expectedOpen: selected?.open,
          amount: field(f, 'amount'),
          date: field(f, 'date'),
          method: field(f, 'method'),
          reference: field(f, 'reference'),
          note: field(f, 'note'),
        })}
      >
        <Amount value={selected?.open} onInput={setTyped} />
        <DateField />
        <label>
          Спосіб
          <AccountSelect />
          <select name="method" className={'block ' + box}>
            <option value="bank">Банк</option>
            <option value="cash">Готівка</option>
            <option value="card">Картка</option>
          </select>
        </label>
        <label>
          Платіжний документ
          <input name="reference" className={'block ' + box} />
        </label>
        <label>
          Коментар
          <input name="note" className={'block ' + box} />
        </label>
      </Operation>
      {split && (
        <p>
          На накладну {hryvnia(split.applied)} грн · У вільний аванс {hryvnia(split.advance)} грн
        </p>
      )}
    </section>
  )
}
export function Account({
  account: a,
  rights,
  receiptId,
  live,
}: {
  account: AccountData
  rights: Rights
  receiptId?: string
  live: boolean
}) {
  const target = a.rows.find((r) => r.receiptId === receiptId && r.active)
  const credits = a.rows.filter((r) => isCredit(r.kind) && kopecks(r.open) > 0)
  const debits = a.rows
    .filter((r) => !isCredit(r.kind) && kopecks(r.open) > 0)
    .sort((x, y) => (x.due || '9999').localeCompare(y.due || '9999'))
  const [creditId, setCredit] = useState(credits[0]?.id || '')
  const credit = credits.find((r) => r.id === creditId) || credits[0]
  const selected = target && kopecks(target.open) > 0 ? target : undefined
  const proposal = credit ? suggestedDistribution(credit.open, selected ? [selected] : debits) : {}
  const unknown = a.unknown.filter((r) => !receiptId || r.id === receiptId)
  return (
    <div className="space-y-5">
      <p>
        Відкриті зобов’язання <b>{a.debt} грн</b> · Вільні аванси <b>{a.advance} грн</b> · Сальдо
        (борг мінус аванс) <b>{a.net} грн</b> · Прострочено <b>{a.overdue} грн</b>
      </p>
      {target && (
        <p>
          Накладна № {target.reference} · Зараховано{' '}
          {hryvnia(kopecks(target.amount) - kopecks(target.open))} грн · Відкрито до сплати{' '}
          <strong>{target.open} грн</strong> · Строк {target.due || 'не вказано'}
        </p>
      )}
      {live &&
        unknown.map((r) => (
          <section className="rounded border p-3" key={r.id}>
            № {r.number} · {r.total} грн · Розрахунки не звірено
            {rights.manage && (
              <Operation
                supplier={a.id}
                label="Підтвердити відкритий залишок"
                build={(f) => ({
                  op: 'reconcile',
                  receipt: r.id,
                  amount: field(f, 'amount'),
                  date: field(f, 'date'),
                  due: field(f, 'due') || undefined,
                })}
              >
                <Amount zero />
                <DateField />
                <label>
                  Строк оплати
                  <input className={box} type="date" name="due" />
                </label>
              </Operation>
            )}
          </section>
        ))}
      {live && rights.create && (!receiptId || selected) && (
        <PaymentForm
          key={(selected?.id ?? a.id) + ':' + (selected?.open ?? '')}
          supplierId={a.id}
          selected={selected}
        />
      )}
      {live && rights.create && credit && debits.length > 0 && (!receiptId || selected) && (
        <section className="rounded border p-4">
          <h2 className="font-semibold">Зарахувати наявний аванс</h2>
          <label>
            Джерело
            <select className={box} value={credit.id} onChange={(e) => setCredit(e.target.value)}>
              {credits.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.date} · {r.reference || kinds[r.kind]} · {r.open} грн
                </option>
              ))}
            </select>
          </label>
          <Operation
            key={credit.id + '-' + credit.open + '-' + (selected?.open ?? '')}
            supplier={a.id}
            label="Зарахувати аванс"
            build={(f) => ({
              op: 'allocate',
              credit: credit.id,
              date: field(f, 'date'),
              targets: debits
                .filter((r) => Number(field(f, r.id)) > 0)
                .map((r) => ({ id: r.id, amount: field(f, r.id) })),
            })}
          >
            <DateField />
            {(selected ? [selected] : debits).map((r) => (
              <label key={r.id}>
                {r.reference || kinds[r.kind]} · відкрито {r.open}
                <input
                  type="number"
                  step=".01"
                  min="0"
                  max={r.open}
                  defaultValue={proposal[r.id] ?? ''}
                  className={'block ' + box}
                  name={r.id}
                />
              </label>
            ))}
          </Operation>
        </section>
      )}
      {live && rights.manage && !receiptId && (
        <details>
          <summary>Внести початкове сальдо після звірки</summary>
          <p>Включайте лише суми, які ще не враховано за окремими накладними.</p>
          <Operation
            supplier={a.id}
            label="Зберегти початкове сальдо"
            build={(f) => ({
              op: 'opening',
              kind: field(f, 'kind'),
              amount: field(f, 'amount'),
              note: field(f, 'note'),
              date: field(f, 'date'),
            })}
          >
            <select className={box} aria-label="Вид залишку" name="kind">
              <option value="opening_debt">Наш борг</option>
              <option value="opening_credit">Наш аванс</option>
            </select>
            <Amount />
            <DateField />
            <label>
              Підстава звірки
              <input required name="note" className={'block ' + box} />
            </label>
          </Operation>
        </details>
      )}
      <h2 className="font-semibold">Історія розрахунків</h2>
      {a.rows
        .filter(
          (r) =>
            !receiptId || r.receiptId === receiptId || r.links.some((l) => l.debit === target?.id)
        )
        .map((r) => (
          <details key={r.id} className="rounded border p-3">
            <summary>
              {r.date} · {kinds[r.kind]} {r.reference} · {r.amount} грн ·{' '}
              {r.active ? 'Залишок ' + r.open + ' грн' : 'Скасовано'}
            </summary>
            <p>
              {r.note} {r.reason} · Вніс {r.createdBy} ·{' '}
              {new Date(r.createdAt).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' })}{' '}
              {r.reversedBy && '· Скасував ' + r.reversedBy}
            </p>
            {r.receiptId && (
              <Link className="underline" href={'/receipts/' + r.receiptId}>
                Відкрити накладну
              </Link>
            )}
            {live && rights.manage && r.kind === 'receipt' && r.active && (
              <Operation
                supplier={a.id}
                label="Змінити строк оплати"
                build={(f) => ({ op: 'due', entry: r.id, due: field(f, 'due') })}
              >
                <input
                  aria-label="Строк оплати"
                  className={box}
                  required
                  type="date"
                  name="due"
                  defaultValue={r.due ?? ''}
                />
              </Operation>
            )}
            {r.links.map((l) => (
              <div className="ml-4" key={l.id}>
                Зарахування · {l.date} · {l.amount} грн ·{' '}
                {a.rows.find((x) => x.id === (isCredit(r.kind) ? l.debit : l.credit))?.reference} ·{' '}
                {l.createdBy} {l.active ? '' : 'Скасовано · ' + l.reason}
                {live && rights.reverse && l.active && (
                  <Operation
                    supplier={a.id}
                    label="Скасувати зарахування"
                    build={(f) => ({
                      op: 'reverse',
                      kind: 'allocation',
                      id: l.id,
                      reason: field(f, 'reason'),
                    })}
                  >
                    <input
                      aria-label="Причина"
                      className={box}
                      name="reason"
                      required
                      placeholder="Причина"
                    />
                  </Operation>
                )}
              </div>
            ))}
            {live && rights.reverse && r.active && r.kind !== 'receipt' && (
              <Operation
                supplier={a.id}
                label="Скасувати запис"
                build={(f) => ({
                  op: 'reverse',
                  kind: 'entry',
                  id: r.id,
                  reason: field(f, 'reason'),
                })}
              >
                <input
                  aria-label="Причина"
                  className={box}
                  name="reason"
                  required
                  placeholder="Причина"
                />
              </Operation>
            )}
          </details>
        ))}
    </div>
  )
}
