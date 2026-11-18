'use client'
import { useOperationText } from '@/i18n/use-operation-text'
import { MoneySummary } from '@/components/operations/document-ui'
import { moneyLabel, dayLabel } from '@/features/finance/presentation'
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
  return_credit: 'Повернення постачальнику',
  adjustment_debt: 'Коригування · збільшення нашого боргу',
  adjustment_credit: 'Коригування · зменшення нашого боргу',
  opening_credit: 'Початковий аванс',
  opening_debt: 'Початковий борг',
}
const box = 'min-h-11 min-w-0 w-full rounded-md border bg-background px-3 py-2'
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
  const ot = useOperationText()

  const router = useRouter(),
    [pending, start] = useTransition(),
    [message, setMessage] = useState(''),
    key = useRef('')
  return (
    <form
      className="ops-form py-4"
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
              setMessage(result.error || ot('Помилка'))
              return
            }
            key.current = ''
            form.reset()
            onSaved?.()
            setMessage(ot('Збережено'))
            router.refresh()
          } catch {
            setMessage(ot('Перевірте результат та повторіть за потреби.'))
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
  const ot = useOperationText()

  return (
    <label>
      {ot('Сума, грн')}
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
  const ot = useOperationText()

  return (
    <label>
      {ot('Дата операції')}
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
  const ot = useOperationText()

  const [typed, setTyped] = useState('')
  const split =
    selected && /^\d{1,18}(\.\d{1,2})?$/.test(typed)
      ? splitPayment(kopecks(typed), kopecks(selected.open))
      : null
  return (
    <section className="ops-panel space-y-4">
      <h2 className="font-semibold">
        {selected
          ? ot("Оплата за накладною № ") + selected.reference
          : ot('Зареєструвати платіж постачальнику')}
      </h2>
      <Operation
        supplier={supplierId}
        onSaved={() => setTyped('')}
        label={ot('Зареєструвати оплату')}
        build={(f) => ({
          op: 'payment',
          moneyAccountId: field(f, 'moneyAccountId') || undefined,
          target: selected?.id,
          expectedOpen: selected?.open,
          amount: field(f, 'amount'),
          date: field(f, 'date'),
          method: field(f, 'method') || undefined,
          reference: field(f, 'reference'),
          note: field(f, 'note'),
        })}
      >
        <Amount value={selected?.open} onInput={setTyped} />
        <DateField />
        <AccountSelect
          inactiveFallback={
            <label>
              {ot('Спосіб')}
              <select name="method" className={'block ' + box}>
                <option value="bank">{ot('Банк')}</option>
                <option value="cash">{ot('Готівка')}</option>
                <option value="card">{ot('Картка')}</option>
              </select>
            </label>
          }
        />
        <label>
          {ot('Платіжний документ')}
          <input name="reference" className={'block ' + box} />
        </label>
        <label>
          {ot('Коментар')}
          <input name="note" className={'block ' + box} />
        </label>
      </Operation>
      {split && (
        <p>
          {ot("На накладну ")}
          {hryvnia(split.applied)} {ot(" грн · У вільний аванс ")}
          {hryvnia(split.advance)} {ot(" грн")}
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
  const ot = useOperationText()

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
    <div className="ops-workspace space-y-5">
      <MoneySummary
        items={
          target
            ? [
                { label: ot('Сума накладної'), value: target.amount },
                {
                  label: ot('Зараховано'),
                  value: hryvnia(kopecks(target.amount) - kopecks(target.open)),
                },
                {
                  label: ot('До сплати'),
                  value: target.open,
                  emphasis: true,
                  hint: target.due ? ot("Строк оплати: ") + target.due : undefined,
                },
              ]
            : [
                { label: ot('Сальдо постачальника'), value: a.net, emphasis: true },
                { label: ot('Прострочено'), value: a.overdue },
                { label: ot('Вільні аванси'), value: a.advance },
              ]
        }
      />
      {live &&
        unknown.map((r) => (
          <section className="ops-panel" key={r.id}>
            № {r.number} · {r.total} {ot(" грн · Розрахунки не звірено")}
            {rights.manage && (
              <Operation
                supplier={a.id}
                label={ot('Підтвердити відкритий залишок')}
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
                  {ot('Строк оплати')}
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
        <details className="ops-panel">
          <summary>
            {credit.kind === 'return_credit'
              ? ot('Зарахувати повернення')
              : credit.kind === 'adjustment_credit'
                ? ot('Зарахувати коригування')
                : ot('Зарахувати наявний аванс')}
          </summary>
          <label className="grid min-w-0 gap-2 text-sm">
            {ot('Джерело')}
            <select className={box} value={credit.id} onChange={(e) => setCredit(e.target.value)}>
              {credits.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.date} · {r.reference || kinds[r.kind]} · {r.open} {ot(" грн")}
                </option>
              ))}
            </select>
          </label>
          <Operation
            key={credit.id + '-' + credit.open + '-' + (selected?.open ?? '')}
            supplier={a.id}
            label={
              credit.kind === 'return_credit'
                ? ot('Зарахувати повернення')
                : credit.kind === 'adjustment_credit'
                  ? ot('Зарахувати коригування')
                  : ot('Зарахувати аванс')
            }
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
                {r.reference || kinds[r.kind]} {ot(" · відкрито ")}
                {r.open}
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
        </details>
      )}
      {live && rights.manage && !receiptId && (
        <details className="ops-panel">
          <summary>{ot('Внести початкове сальдо після звірки')}</summary>
          <p>{ot('Включайте лише суми, які ще не враховано за окремими накладними.')}</p>
          <Operation
            supplier={a.id}
            label={ot('Зберегти початкове сальдо')}
            build={(f) => ({
              op: 'opening',
              kind: field(f, 'kind'),
              amount: field(f, 'amount'),
              note: field(f, 'note'),
              date: field(f, 'date'),
            })}
          >
            <select className={box} aria-label={ot('Вид залишку')} name="kind">
              <option value="opening_debt">{ot('Наш борг')}</option>
              <option value="opening_credit">{ot('Наш аванс')}</option>
            </select>
            <Amount />
            <DateField />
            <label>
              {ot('Підстава звірки')}
              <input required name="note" className={'block ' + box} />
            </label>
          </Operation>
        </details>
      )}
      {live && rights.manage && !receiptId && (
        <details className="ops-panel">
          <summary>{ot('Коригування взаєморозрахунків')}</summary>
          <p className="my-2 text-sm">
            {ot(
              'Вкажіть різницю за звіркою. Коригування змінює сальдо постачальника без руху грошей у касі.'
            )}
          </p>
          <Operation
            supplier={a.id}
            label={ot('Провести коригування')}
            build={(f) => ({
              op: 'adjustment',
              kind: field(f, 'kind'),
              amount: field(f, 'amount'),
              date: field(f, 'date'),
              note: field(f, 'note'),
            })}
          >
            <label>
              {ot('Дія')}
              <select name="kind" className={box}>
                <option value="adjustment_credit">{ot('Зменшити наш борг')}</option>
                <option value="adjustment_debt">{ot('Збільшити наш борг')}</option>
              </select>
            </label>
            <Amount />
            <DateField />
            <label>
              {ot('Підстава коригування')}
              <input name="note" className={box} required maxLength={500} />
            </label>
          </Operation>
        </details>
      )}
      <h2 className="font-semibold">{ot('Історія розрахунків')}</h2>
      {a.rows
        .filter(
          (r) =>
            !receiptId || r.receiptId === receiptId || r.links.some((l) => l.debit === target?.id)
        )
        .map((r) => (
          <details key={r.id} className="ops-panel">
            <summary>
              <span className="inline-grid w-[calc(100%-1rem)] gap-2 align-top sm:grid-cols-[minmax(0,1fr)_auto]">
                <span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    {dayLabel(r.date)}
                  </span>
                  {kinds[r.kind]} {r.reference}
                </span>
                <span className="sm:text-right">
                  {moneyLabel(r.amount, ot('грн'))}
                  <span className="block text-xs font-normal text-muted-foreground">
                    {r.active ? ot("Залишок ") + moneyLabel(r.open, ot('грн')) : ot('Скасовано')}
                  </span>
                </span>
              </span>
            </summary>
            <p>
              {r.note} {r.reason} {ot(" · Вніс ")}
              {r.createdBy} ·{' '}
              {new Date(r.createdAt).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' })}{' '}
              {r.reversedBy && ot("· Скасував ") + r.reversedBy}
            </p>
            {r.returnUrl && (
              <Link className="underline" href={r.returnUrl}>
                {ot('Відкрити повернення')}
              </Link>
            )}
            {r.receiptId && (
              <Link className="underline" href={'/receipts/' + r.receiptId}>
                {ot('Відкрити накладну')}
              </Link>
            )}
            {live && rights.manage && r.kind === 'receipt' && r.active && (
              <Operation
                supplier={a.id}
                label={ot('Змінити строк оплати')}
                build={(f) => ({ op: 'due', entry: r.id, due: field(f, 'due') })}
              >
                <input
                  aria-label={ot('Строк оплати')}
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
                {ot("Зарахування · ")}
                {l.date} · {l.amount} {ot(" грн ·")}{' '}
                {a.rows.find((x) => x.id === (isCredit(r.kind) ? l.debit : l.credit))?.reference} ·{' '}
                {l.createdBy} {l.active ? '' : ot("Скасовано · ") + l.reason}
                {live && rights.reverse && l.active && (
                  <Operation
                    supplier={a.id}
                    label={ot('Скасувати зарахування')}
                    build={(f) => ({
                      op: 'reverse',
                      kind: 'allocation',
                      id: l.id,
                      reason: field(f, 'reason'),
                    })}
                  >
                    <input
                      aria-label={ot('Причина')}
                      className={box}
                      name="reason"
                      required
                      placeholder={ot('Причина')}
                    />
                  </Operation>
                )}
              </div>
            ))}
            {live &&
              rights.reverse &&
              r.active &&
              r.kind !== 'receipt' &&
              r.kind !== 'return_credit' && (
                <Operation
                  supplier={a.id}
                  label={ot('Скасувати запис')}
                  build={(f) => ({
                    op: 'reverse',
                    kind: 'entry',
                    id: r.id,
                    reason: field(f, 'reason'),
                  })}
                >
                  <input
                    aria-label={ot('Причина')}
                    className={box}
                    name="reason"
                    required
                    placeholder={ot('Причина')}
                  />
                </Operation>
              )}
          </details>
        ))}
    </div>
  )
}
