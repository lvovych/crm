'use client'
import { useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  financeReport,
  saveFinanceDraft,
  postSavedFinanceDraft,
  discardFinanceDraft,
  saveFinanceDirectory,
  postFinanceDocument,
  prepareCashOpening,
  activateCashOpening,
  reverseMoneyDocument,
  assignUnlinkedPayment,
  refundMoneyDocument,
} from './actions'
import { cents, decimal } from './money'
type Report = NonNullable<Awaited<ReturnType<typeof financeReport>>['data']>
const labels: Record<string, string> = {
  income: 'Надходження',
  expense: 'Виплата',
  transfer: 'Переказ',
  opening: 'Початковий залишок',
  customer_payment: 'Оплата клієнта',
  supplier_payment: 'Оплата постачальнику',
  reversal: 'Сторно',
  refund: 'Повернення',
}
const selectClass = 'min-h-11 w-full rounded-md border bg-background px-3'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  )
}
export function FinanceClient({ initial, today }: { initial: Report; today: string }) {
  const [data, setData] = useState(initial),
    [date, setDate] = useState(today),
    [filter, setFilter] = useState(''),
    [category, setCategory] = useState(''),
    [query, setQuery] = useState(''),
    [from, setFrom] = useState('')
  const [modal, setModal] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [selected, setSelected] = useState('')
  const reportRequest = useRef(0)
  const key = useRef(''),
    pending = useRef(false)
  const open = (kind: string, id = '') => {
    key.current = crypto.randomUUID()
    setError('')
    setSelected(id)
    setModal(kind)
  }
  const refresh = async (asOf = date) => {
    const request = ++reportRequest.current
    const r = await financeReport(asOf)
    if (request !== reportRequest.current) return
    if (r.success && r.data) setData(r.data)
    else setError(r.error || 'Не вдалося оновити дані.')
  }
  const accounts = data.accounts.filter((a) => !a.archived)
  const knownBalance = data.asOf === date && data.active && !!data.start && date >= data.start
  const rows = data.entries.filter(
    (e) =>
      (!from || e.date >= from) &&
      (!filter || e.accountId === filter) &&
      (!category || e.category === category) &&
      (!query ||
        `${e.note} ${e.counterparty} ${e.author}`.toLowerCase().includes(query.toLowerCase()))
  )
  const total = decimal(data.accounts.reduce((s, a) => s + cents(a.balance), BigInt('0')))
  const accountSelect = (name: string) => (
    <select
      name={name}
      required
      className={selectClass}
      defaultValue={accounts.length === 1 ? accounts[0].id : ''}
    >
      <option value="">Оберіть рахунок</option>
      {accounts
        .filter((a) => data.postAccountIds.includes(a.id))
        .map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} · {a.entity}
          </option>
        ))}
    </select>
  )
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    const f = new FormData(event.currentTarget),
      v = (name: string) => String(f.get(name) ?? '')
    try {
      let result
      if (['entity', 'account', 'category'].includes(modal))
        result = await saveFinanceDirectory({
          type: modal,
          name: v('name'),
          taxId: v('taxId'),
          kind: v('kind'),
          legalEntityId: v('legalEntityId'),
          iban: v('iban'),
          direction: v('direction'),
          allowNegative: f.get('allowNegative') === 'on',
        })
      else if (modal.startsWith('rename:'))
        result = await saveFinanceDirectory({
          type: 'rename',
          kind: modal.split(':')[1],
          id: selected,
          name: v('name'),
        })
      else if (modal === 'access')
        result = await saveFinanceDirectory({
          type: 'access',
          accountId: v('accountId'),
          roleId: v('roleId'),
          canRead: f.get('canRead') === 'on',
          canPost: f.get('canPost') === 'on',
        })
      else if (modal === 'archive')
        result = await saveFinanceDirectory({
          type: 'archive',
          accountId: selected,
          archived: !data.accounts.find((a) => a.id === selected)?.archived,
        })
      else if (modal === 'opening')
        result = await prepareCashOpening({
          date: v('date'),
          balances: accounts.map((a) => ({ accountId: a.id, amount: v(a.id) })),
        })
      else if (modal === 'postDraft') result = await postSavedFinanceDraft(selected)
      else if (modal === 'discardDraft') result = await discardFinanceDraft(selected)
      else if (modal === 'activate') result = await activateCashOpening(selected)
      else if (modal === 'reverse')
        result = await reverseMoneyDocument({
          id: selected,
          requestId: key.current,
          date: v('date'),
          reason: v('note'),
        })
      else if (modal === 'refund')
        result = await refundMoneyDocument({
          id: selected,
          requestId: key.current,
          date: v('date'),
          amount: v('amount'),
          reason: v('note'),
        })
      else if (modal === 'assign')
        result = await assignUnlinkedPayment({
          paymentId: selected,
          accountId: v('targetAccountId'),
          requestId: key.current,
        })
      else
        result = await ((event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') ===
          'draft'
          ? saveFinanceDraft
          : postFinanceDocument)({
          requestId: key.current,
          kind: modal,
          date: v('date'),
          amount: v('amount'),
          sourceAccountId: v('sourceAccountId') || undefined,
          targetAccountId: v('targetAccountId') || undefined,
          categoryId: v('categoryId') || undefined,
          counterpartyLabel: v('counterpartyLabel') || undefined,
          note: v('note'),
        })
      if (!result.success) {
        setError(result.error || 'Не вдалося зберегти. Перевірте поля.')
        return
      }
      await refresh()
      setModal('')
      toast.success('Збережено')
    } catch {
      setError('Не вдалося зберегти. Введені дані збережені у формі.')
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Каси та рахунки</h1>
          <p className="text-muted-foreground">Залишки грошей і журнал операцій</p>
        </div>
        <Field label="Залишки на кінець дати">
          <Input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value)
              if (e.target.value) void refresh(e.target.value)
            }}
          />
        </Field>
      </div>
      {!data.active ? (
        <section className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-4">
          <h2 className="font-semibold">Підготовка касового обліку</h2>
          <p className="mt-1 text-sm">
            Поточні оплати працюють як раніше. Створіть рахунки та підготуйте залишки. Активація —
            тільки після окремого погодження.
          </p>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">
          Облік активний з {data.start}.{' '}
          {data.start && date < data.start ? 'На цю дату касові залишки не підтверджені.' : ''}
        </p>
      )}
      <section className="grid gap-3 sm:grid-cols-3" aria-label="Залишки">
        <div className="rounded-xl border p-4">
          <p>Усього на доступних рахунках</p>
          <strong className="text-2xl">{knownBalance ? `${total} ₴` : 'Не підтверджено'}</strong>
        </div>
        {['cash', 'bank'].map((kind) => (
          <div key={kind} className="rounded-xl border p-4">
            <p>{kind === 'cash' ? 'Готівка' : 'Банк'}</p>
            <strong className="text-2xl">
              {knownBalance
                ? `${decimal(data.accounts.filter((a) => a.kind === kind).reduce((s, a) => s + cents(a.balance), BigInt('0')))} ₴`
                : 'Не підтверджено'}
            </strong>
          </div>
        ))}
      </section>
      <div className="flex flex-wrap gap-2">
        {['income', 'expense', 'transfer'].map((k) => (
          <Button
            key={k}
            disabled={
              !data.active ||
              !data.capabilities.post ||
              (k === 'transfer' && !data.capabilities.transfer)
            }
            onClick={() => open(k)}
            variant={k === 'income' ? 'default' : 'outline'}
            className="min-h-11"
          >
            {labels[k]}
          </Button>
        ))}
      </div>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Рахунки">
        {data.accounts.map((a) => (
          <button
            key={a.id}
            onClick={() => setFilter(filter === a.id ? '' : a.id)}
            aria-pressed={filter === a.id}
            className={`rounded-xl border p-4 text-left ${filter === a.id ? 'border-primary bg-primary/10' : ''}`}
          >
            <div className="font-semibold">
              {a.name}
              {a.archived ? ' · Архів' : ''}
            </div>
            <div className="text-sm text-muted-foreground">
              {a.entity} · {a.kind === 'cash' ? 'Готівка' : 'Банк'}
            </div>
            <div className="mt-2 text-xl font-semibold">
              {knownBalance ? `${a.balance} ₴` : 'Не підтверджено'}
            </div>
          </button>
        ))}
        {!accounts.length && <p>Рахунків поки немає. Додайте власні реквізити та першу касу.</p>}
      </section>
      {data.isAdmin && (
        <details className="rounded-xl border p-4">
          <summary className="cursor-pointer font-semibold">
            Налаштування та початкові залишки
          </summary>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => open('entity')}>
              Додати власні реквізити
            </Button>
            <Button
              variant="outline"
              disabled={!data.entities.length}
              onClick={() => open('account')}
            >
              Додати касу / рахунок
            </Button>
            <Button variant="outline" onClick={() => open('category')}>
              Додати статтю
            </Button>
            <Button
              variant="outline"
              disabled={data.active || !accounts.length}
              onClick={() => open('opening')}
            >
              Підготувати залишки
            </Button>
          </div>
          <Button className="mt-3" variant="outline" onClick={() => open('access')}>
            Доступ ролей до кас
          </Button>
          <div className="mt-3 space-y-2">
            {data.accounts.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{a.name}</span>
                <Button variant="outline" onClick={() => open('archive', a.id)}>
                  {a.archived ? 'Відновити' : 'Архівувати'}
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-2">
            {[
              ...data.accounts.map((a) => ({ ...a, kind: 'account' })),
              ...data.entities.map((a) => ({ ...a, kind: 'entity' })),
              ...data.categories.map((a) => ({ ...a, kind: 'category' })),
            ].map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{a.name}</span>
                <Button variant="outline" onClick={() => open(`rename:${a.kind}`, a.id)}>
                  Змінити назву
                </Button>
              </div>
            ))}
          </div>
          {data.batches.map((b) => (
            <div key={b.id} className="mt-3 rounded border p-3">
              <p>
                Залишки на початок {b.date} ·{' '}
                {b.status === 'activated' ? 'Активовано' : 'Потребує погодження'}
              </p>
              <ul className="my-2 text-sm">
                {(b.balances as { accountId: string; amount: string }[]).map((x) => (
                  <li key={x.accountId}>
                    {data.accounts.find((a) => a.id === x.accountId)?.name}: {x.amount} ₴
                  </li>
                ))}
              </ul>
              {!data.active && (
                <Button variant="outline" onClick={() => open('activate', b.id)}>
                  Активувати погоджені залишки
                </Button>
              )}
            </div>
          ))}
        </details>
      )}
      {data.drafts.length > 0 && (
        <section className="rounded-xl border p-4">
          <h2 className="text-lg font-semibold">Чернетки — не впливають на залишки</h2>
          {data.drafts.map((d) => (
            <article
              key={d.id}
              className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3"
            >
              <span>
                {d.date} · {labels[d.kind]} · {d.amount} ₴ · {d.note}
              </span>
              <div className="flex gap-2">
                {data.capabilities.post && (
                  <Button disabled={!data.active} onClick={() => open('postDraft', d.id)}>
                    Провести
                  </Button>
                )}
                {data.capabilities.draft && (
                  <Button variant="outline" onClick={() => open('discardDraft', d.id)}>
                    Видалити чернетку
                  </Button>
                )}
              </div>
            </article>
          ))}
        </section>
      )}
      {data.unlinked.length > 0 && (
        <section className="rounded-xl border border-amber-500 p-4">
          <h2 className="font-semibold">Оплати без каси — потребують звірки</h2>
          <p className="text-sm">
            Ці оплати вже враховані в нарядах, але ще не включені в залишки кас.
          </p>
          {data.unlinked.map((p) => (
            <div key={p.id} className="mt-2 flex flex-wrap justify-between gap-2 border-t pt-2">
              <span>
                {p.date} · {p.amount} ₴ · {p.provider || 'Оплата'}
              </span>
              <Button variant="outline" onClick={() => open('assign', p.id)}>
                Визначити касу
              </Button>
            </div>
          ))}
        </section>
      )}
      <section className="rounded-xl border p-4">
        <h2 className="text-lg font-semibold">Журнал руху коштів</h2>
        <p className="text-sm text-muted-foreground">Рухи до {data.asOf} включно</p>
        <div className="my-4 grid gap-3 sm:grid-cols-4">
          <Field label="Операції від">
            <Input type="date" value={from} max={date} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Рахунок">
            <select
              className={selectClass}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="">Усі доступні</option>
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Стаття">
            <select
              className={selectClass}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">Усі статті</option>
              {data.categories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Пошук">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Контрагент, примітка, автор"
            />
          </Field>
        </div>
        <div className="space-y-2">
          {rows.map((e) => (
            <article
              key={e.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <p className="font-medium">
                  {labels[e.kind] || e.kind} ·{' '}
                  {data.accounts.find((a) => a.id === e.accountId)?.name}
                </p>
                <p className="text-sm text-muted-foreground">
                  {e.date} · {e.category || 'Системна операція'} {e.counterparty}
                </p>
                <p className="break-words text-sm">{e.note}</p>
                <p className="text-xs text-muted-foreground">
                  {e.author} · Залишок після руху: {e.runningBalance} ₴
                  {e.reversed ? ' · Сторновано' : ''}
                </p>
                {e.link && (
                  <Link
                    className="mt-2 inline-flex min-h-11 items-center rounded-md border px-3 text-sm"
                    href={e.link}
                  >
                    Відкрити документ
                  </Link>
                )}
              </div>
              <div className="flex items-center gap-3">
                <strong
                  className={cents(e.amount) < BigInt('0') ? 'text-red-500' : 'text-green-600'}
                >
                  {cents(e.amount) > BigInt('0') ? '+' : ''}
                  {e.amount} ₴
                </strong>
                {data.capabilities.reverse &&
                  ['customer_payment', 'supplier_payment'].includes(e.kind) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => open('refund', e.documentId)}
                    >
                      Повернення
                    </Button>
                  )}
                {data.capabilities.reverse &&
                  !['opening', 'reversal', 'refund'].includes(e.kind) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => open('reverse', e.documentId)}
                    >
                      Сторно
                    </Button>
                  )}
              </div>
            </article>
          ))}
          {!rows.length && (
            <p className="py-6 text-center text-muted-foreground">
              Операцій за вибраними умовами немає.
            </p>
          )}
        </div>
      </section>
      {error && !modal && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <Dialog
        open={!!modal}
        onOpenChange={(next) => {
          if (!next && !pending.current) setModal('')
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>
              {modal.startsWith('rename:')
                ? 'Змінити назву'
                : labels[modal] ||
                  {
                    postDraft: 'Провести чернетку',
                    discardDraft: 'Видалити чернетку',
                    access: 'Доступ ролі до каси',
                    archive: data.accounts.find((a) => a.id === selected)?.archived
                      ? 'Відновити рахунок'
                      : 'Архівувати рахунок',
                    entity: 'Власні реквізити',
                    account: 'Нова каса / рахунок',
                    category: 'Стаття руху коштів',
                    opening: 'Початкові залишки',
                    activate: 'Активація обліку',
                    reverse: 'Сторнувати операцію',
                    assign: 'Звірити оплату',
                  }[modal]}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <fieldset disabled={busy} className="space-y-4">
              {(['entity', 'account', 'category'].includes(modal) ||
                modal.startsWith('rename:')) && (
                <Field label="Назва">
                  <Input
                    name="name"
                    required
                    maxLength={150}
                    defaultValue={
                      modal.startsWith('rename:')
                        ? ([...data.accounts, ...data.entities, ...data.categories].find(
                            (a) => a.id === selected
                          )?.name ?? '')
                        : ''
                    }
                  />
                </Field>
              )}
              {['postDraft', 'discardDraft'].includes(modal) && (
                <p>
                  {data.drafts.find((d) => d.id === selected)?.note} ·{' '}
                  {data.drafts.find((d) => d.id === selected)?.amount} ₴
                </p>
              )}
              {modal === 'archive' && (
                <p>Рахунок залишиться в історії, але буде недоступним для нових операцій.</p>
              )}
              {modal === 'access' && (
                <>
                  <Field label="Рахунок">{accountSelect('accountId')}</Field>
                  <Field label="Роль">
                    <select name="roleId" required className={selectClass}>
                      {data.roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <label className="flex gap-2">
                    <input name="canRead" type="checkbox" defaultChecked />
                    Перегляд залишків і рухів
                  </label>
                  <label className="flex gap-2">
                    <input name="canPost" type="checkbox" />
                    Проведення операцій
                  </label>
                  <p className="text-sm">
                    Додатково роль повинна мати відповідні права в налаштуваннях ролей.
                  </p>
                </>
              )}
              {modal === 'entity' && (
                <Field label="Податковий номер">
                  <Input name="taxId" />
                </Field>
              )}
              {modal === 'account' && (
                <>
                  <Field label="Власні реквізити">
                    <select name="legalEntityId" required className={selectClass}>
                      {data.entities.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Тип">
                    <select name="kind" className={selectClass}>
                      <option value="cash">Готівкова каса</option>
                      <option value="bank">Банківський рахунок</option>
                    </select>
                  </Field>
                  <Field label="IBAN (для банку)">
                    <Input name="iban" />
                  </Field>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="allowNegative" />
                    Дозволити від’ємний залишок банку
                  </label>
                </>
              )}
              {modal === 'category' && (
                <Field label="Напрям">
                  <select name="direction" className={selectClass}>
                    <option value="expense">Виплата</option>
                    <option value="income">Надходження</option>
                  </select>
                </Field>
              )}
              {['income', 'expense', 'transfer', 'opening', 'reverse', 'refund'].includes(
                modal
              ) && (
                <Field label={modal === 'opening' ? 'На початок дати' : 'Дата операції'}>
                  <Input name="date" type="date" required defaultValue={today} max={today} />
                </Field>
              )}
              {['expense', 'transfer'].includes(modal) && (
                <Field label="З рахунку">{accountSelect('sourceAccountId')}</Field>
              )}
              {['income', 'transfer', 'assign'].includes(modal) && (
                <Field label="На рахунок">{accountSelect('targetAccountId')}</Field>
              )}
              {['income', 'expense', 'transfer', 'refund'].includes(modal) && (
                <Field label="Сума, грн">
                  <Input name="amount" inputMode="decimal" required placeholder="0,00" />
                </Field>
              )}
              {['income', 'expense'].includes(modal) && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Оплату наряду реєструйте в наряді, оплату постачальнику — у взаєморозрахунках.
                    Тут вносьте інші рухи, щоб не дублювати платежі.
                  </p>
                  <Field label="Стаття">
                    <select name="categoryId" required className={selectClass}>
                      <option value="">Оберіть статтю</option>
                      {data.categories
                        .filter((c) => !c.archived && c.direction === modal)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Контрагент / призначення">
                    <Input name="counterpartyLabel" />
                  </Field>
                </>
              )}
              {['income', 'expense', 'transfer', 'reverse', 'refund'].includes(modal) && (
                <Field label={modal === 'reverse' ? 'Причина сторно' : 'Примітка'}>
                  <Input name="note" required maxLength={1000} />
                </Field>
              )}
              {modal === 'opening' && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Фактичні залишки до першої операції цього дня. Підготовка не активує облік.
                  </p>
                  {accounts.map((a) => (
                    <Field key={a.id} label={a.name}>
                      <Input name={a.id} inputMode="decimal" required defaultValue="0.00" />
                    </Field>
                  ))}
                </>
              )}
              {modal === 'activate' && (
                <p>
                  Підтверджуйте тільки після погодження фактичних залишків і перевірки прав
                  працівників. На проді активація додатково вимкнена конфігурацією.
                </p>
              )}
            </fieldset>
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
            <div className="flex gap-2 border-t pt-4">
              <Button type="button" variant="outline" disabled={busy} onClick={() => setModal('')}>
                Скасувати
              </Button>
              {['income', 'expense', 'transfer'].includes(modal) && data.capabilities.draft && (
                <Button type="submit" value="draft" variant="outline" disabled={busy}>
                  Зберегти чернетку
                </Button>
              )}
              <Button type="submit" className="flex-1" disabled={busy}>
                {busy
                  ? 'Збереження…'
                  : modal === 'opening'
                    ? 'Зберегти для погодження'
                    : modal === 'activate'
                      ? 'Підтвердити активацію'
                      : modal === 'postDraft'
                        ? 'Провести'
                        : modal === 'discardDraft'
                          ? 'Видалити чернетку'
                          : ['income', 'expense', 'transfer'].includes(modal)
                            ? 'Провести'
                            : 'Зберегти'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  )
}
