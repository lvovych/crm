'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  BanknoteArrowDown,
  BanknoteArrowUp,
  ArrowLeftRight,
  History,
  type LucideIcon,
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  financeReport,
  saveFinanceDraft,
  updateFinanceDraft,
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
import { cents, decimal, normalizeMoney } from './money'
import { moneyLabel, dayLabel, groupMovements } from './presentation'
import { AccountAccessForm } from './AccountAccessForm'
type Report = NonNullable<Awaited<ReturnType<typeof financeReport>>['data']>
const labels: Record<string, string> = {
  income: 'Інше надходження коштів',
  expense: 'Інша витрата',
  transfer: 'Переказ між своїми рахунками',
  opening: 'Початковий залишок',
  customer_payment: 'Оплата клієнта',
  supplier_payment: 'Оплата постачальнику',
  reversal: 'Виправлення операції',
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
function AccountAction({
  label,
  icon: Icon,
  disabled,
  onClick,
}: {
  label: string
  icon: LucideIcon
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11 shrink-0 [&_svg]:size-5"
          aria-label={label}
          title={label}
          disabled={disabled}
          onClick={onClick}
        >
          <Icon aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
export function FinanceClient({
  initial,
  today,
  settingsOnly = false,
}: {
  initial: Report
  today: string
  settingsOnly?: boolean
}) {
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
  const errorRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (error && modal) errorRef.current?.focus()
  }, [error, modal])
  const [editingDraft, setEditingDraft] = useState('')
  const [tab, setTab] = useState(settingsOnly ? 'settings' : 'accounts')
  const [partyType, setPartyType] = useState('')
  const [partyId, setPartyId] = useState('')
  const [actionAccount, setActionAccount] = useState('')
  const [accountKind, setAccountKind] = useState('cash')
  const [loading, setLoading] = useState(false)
  const [reportError, setReportError] = useState('')
  const [preview, setPreview] = useState<Record<string, string>>({})
  const reportRequest = useRef(0)
  const key = useRef(''),
    pending = useRef(false)
  const open = (kind: string, id = '', accountId = filter) => {
    setActionAccount(accountId)
    key.current = crypto.randomUUID()
    setError('')
    setSelected(id)
    setEditingDraft('')
    setAccountKind('cash')
    setPreview({})
    setModal(kind)
  }
  const refresh = async (asOf = date) => {
    const request = ++reportRequest.current
    setLoading(true)
    setReportError('')
    try {
      const r = await financeReport(asOf, settingsOnly)
      if (request !== reportRequest.current) return
      if (r.success && r.data) setData(r.data)
      else setReportError(r.error || 'Не вдалося оновити дані.')
    } catch {
      if (request === reportRequest.current)
        setReportError('Не вдалося завантажити залишки. Спробуйте ще раз.')
    } finally {
      if (request === reportRequest.current) setLoading(false)
    }
  }

  const accounts = data.accounts.filter((a) => !a.archived)
  const knownBalance =
    !loading &&
    !reportError &&
    data.asOf === date &&
    data.active &&
    !!data.start &&
    date >= data.start
  const balanceState = loading
    ? 'Завантаження…'
    : reportError
      ? 'Не вдалося завантажити'
      : !data.active
        ? 'Облік ще не активовано'
        : 'Немає підтвердженого залишку на цю дату'
  const permittedAccounts = accounts.filter((a) => data.postAccountIds.includes(a.id))
  const contextAccount =
    permittedAccounts.find((a) => a.id === (actionAccount || filter))?.id ??
    (permittedAccounts.length === 1 ? permittedAccounts[0].id : '')
  const draft = data.drafts.find((d) => d.id === editingDraft)
  const selectedDocument = data.entries.find((e) => e.documentId === selected)
  const parties = [
    ...new Map(
      data.entries
        .filter((e) => e.counterpartyId && (!partyType || e.counterpartyType === partyType))
        .map((e) => [
          `${e.counterpartyType}:${e.counterpartyId}`,
          { id: `${e.counterpartyType}:${e.counterpartyId}`, name: e.counterparty },
        ])
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name, 'uk'))
  const rows = data.entries.filter(
    (e) =>
      e.date <= date &&
      (!from || e.date >= from) &&
      (!partyType || e.counterpartyType === partyType) &&
      (!partyId || `${e.counterpartyType}:${e.counterpartyId}` === partyId) &&
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
      defaultValue={
        draft
          ? ((name === 'sourceAccountId' ? draft.sourceAccountId : draft.targetAccountId) ?? '')
          : modal === 'transfer' && name === 'targetAccountId'
            ? ''
            : contextAccount
      }
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
      else if (modal === 'editEntity')
        result = await saveFinanceDirectory({
          type: 'editEntity',
          id: selected,
          name: v('name'),
          taxId: v('taxId'),
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
        result = await (editingDraft
          ? (payload: unknown) => updateFinanceDraft(editingDraft, payload)
          : (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'draft'
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
      toast.success(
        editingDraft ||
          (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'draft'
          ? 'Чернетку збережено — залишок не змінився'
          : ['income', 'expense', 'transfer', 'postDraft'].includes(modal)
            ? 'Операцію проведено — залишки оновлено'
            : 'Зміни збережено'
      )
    } catch {
      setError('Не вдалося зберегти. Введені дані збережені у формі.')
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  if (settingsOnly && !data.isAdmin) return <p role="alert">Немає доступу до налаштувань кас.</p>
  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {settingsOnly ? 'Налаштування кас і рахунків' : 'Каси та рахунки'}
          </h1>
          <p className="text-muted-foreground">
            {settingsOnly
              ? 'Рахунки, власні реквізити, статті руху коштів і доступи'
              : 'Залишки грошей і журнал операцій'}
          </p>
        </div>
        {!settingsOnly && (
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
        )}
      </div>
      {!settingsOnly && (
        <nav aria-label="Розділи кас" className="flex flex-wrap gap-2 border-b pb-3">
          <Button
            variant={tab === 'accounts' ? 'default' : 'outline'}
            aria-pressed={tab === 'accounts'}
            onClick={() => setTab('accounts')}
          >
            Каси та рахунки
          </Button>
          <Button
            variant={tab === 'operations' ? 'default' : 'outline'}
            aria-pressed={tab === 'operations'}
            onClick={() => setTab('operations')}
          >
            Журнал операцій{data.drafts.length ? ` · Чернетки: ${data.drafts.length}` : ''}
          </Button>
        </nav>
      )}
      {settingsOnly && (
        <Link className="inline-flex min-h-11 items-center rounded-md border px-3" href="/finance">
          ← До кас і рахунків
        </Link>
      )}
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
          Облік активний з {data.start && dayLabel(data.start)}.{' '}
          {data.start && date < data.start ? 'На цю дату касові залишки не підтверджені.' : ''}
        </p>
      )}
      {reportError && (
        <div role="alert" className="rounded-lg border border-destructive p-3">
          {reportError}
          <Button variant="outline" className="ml-2" onClick={() => void refresh()}>
            Повторити
          </Button>
        </div>
      )}
      {!settingsOnly && data.unlinkedCount > 0 && (
        <aside role="status" className="rounded-xl border border-amber-500 bg-amber-500/10 p-4">
          <strong>Оплат без каси: {data.unlinkedCount} — залишки потребують звірки</strong>
          <p className="text-sm">Ці оплати ще не включені в залишки. Не створюйте їх повторно.</p>
          {data.capabilities.manage ? (
            <Button
              variant="outline"
              className="mt-2 min-h-11"
              onClick={() => {
                setTab('operations')
                document.getElementById('unlinked-payments')?.scrollIntoView({ behavior: 'smooth' })
              }}
            >
              Звірити оплати
            </Button>
          ) : (
            <p className="mt-2 text-sm">Зверніться до відповідального за звірку оплат.</p>
          )}
        </aside>
      )}
      {tab === 'accounts' && (
        <>
          <section
            className="grid grid-cols-2 gap-2 sm:grid-cols-3"
            aria-label="Залишки"
            aria-busy={loading}
          >
            <div className="col-span-2 rounded-xl border p-4 sm:col-span-1">
              <p>Усього на доступних рахунках</p>
              <strong className="text-2xl">
                {knownBalance ? moneyLabel(total) : balanceState}
              </strong>
            </div>
            {['cash', 'bank'].map((kind) => (
              <div key={kind} className="rounded-xl border p-4">
                <p>{kind === 'cash' ? 'Готівка' : 'Банк'}</p>
                <strong className="text-lg sm:text-2xl">
                  {knownBalance
                    ? moneyLabel(
                        decimal(
                          data.accounts
                            .filter((a) => a.kind === kind)
                            .reduce((s, a) => s + cents(a.balance), BigInt('0'))
                        )
                      )
                    : '—'}
                </strong>
              </div>
            ))}
          </section>
          {(!data.active || !data.capabilities.post) && (
            <p className="text-sm text-muted-foreground">
              {!data.active
                ? 'Проведення буде доступне після погодження та активації обліку.'
                : 'Ваша роль має доступ лише до перегляду.'}
            </p>
          )}
          <section className="space-y-3" aria-label="Рахунки">
            {data.accounts.map((a) => {
              const canPost =
                data.active &&
                data.capabilities.post &&
                !a.archived &&
                data.postAccountIds.includes(a.id)
              return (
                <article
                  key={a.id}
                  aria-label={a.name}
                  className="grid gap-4 rounded-xl border p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-center"
                >
                  <div className="min-w-0">
                    <h2 className="break-words text-lg font-semibold">
                      {a.name}
                      {a.archived ? ' · Архів' : ''}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {a.entity} · {a.kind === 'cash' ? 'Готівкова каса' : 'Банківський рахунок'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Залишок на {dayLabel(date)}</p>
                    <strong className="text-xl">
                      {knownBalance ? moneyLabel(a.balance) : '—'}
                    </strong>
                  </div>
                  <TooltipProvider delayDuration={200}>
                    <div
                      className="flex flex-wrap gap-2"
                      role="group"
                      aria-label={`Дії: ${a.name}`}
                    >
                      <AccountAction
                        label="Списання"
                        icon={BanknoteArrowUp}
                        disabled={!canPost}
                        onClick={() => open('expense', '', a.id)}
                      />
                      <AccountAction
                        label="Надходження"
                        icon={BanknoteArrowDown}
                        disabled={!canPost}
                        onClick={() => open('income', '', a.id)}
                      />
                      <AccountAction
                        label="Переміщення"
                        icon={ArrowLeftRight}
                        disabled={
                          !canPost || !data.capabilities.transfer || permittedAccounts.length < 2
                        }
                        onClick={() => open('transfer', '', a.id)}
                      />
                      <AccountAction
                        label="Історія"
                        icon={History}
                        onClick={() => {
                          setFilter(a.id)
                          setTab('operations')
                        }}
                      />
                    </div>
                  </TooltipProvider>
                  {!a.archived &&
                    data.active &&
                    data.capabilities.post &&
                    !data.postAccountIds.includes(a.id) && (
                      <p className="text-sm text-muted-foreground lg:col-span-3">
                        Для цього рахунку доступний лише перегляд.
                      </p>
                    )}
                </article>
              )
            })}
            {!accounts.length && (
              <p>
                Активних рахунків поки немає. Додайте власний ФОП / компанію та першу касу в
                налаштуваннях.
              </p>
            )}
          </section>
        </>
      )}
      {data.isAdmin && tab === 'settings' && (
        <details open className="rounded-xl border p-4">
          <summary className="cursor-pointer font-semibold">
            Налаштування та початкові залишки
          </summary>
          {!data.active && (
            <ol className="my-4 grid gap-2 text-sm sm:grid-cols-4" aria-label="Підготовка обліку">
              <li>1. Власний ФОП / компанія</li>
              <li>2. Каси та рахунки</li>
              <li>3. Початкові залишки</li>
              <li>4. Перевірка та погодження</li>
            </ol>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => open('entity')}>
              Додати власний ФОП / компанію
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
              disabled={!data.capabilities.manage || data.active || !accounts.length}
              onClick={() => open('opening')}
            >
              Підготувати залишки
            </Button>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Керування касами не дає права проводити операції. Для операцій потрібні відповідні права
            ролі та доступ до конкретної каси. Початкові залишки й активація потребують окремого
            права звірки.
          </p>
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
                <Button
                  variant="outline"
                  onClick={() =>
                    open(a.kind === 'entity' ? 'editEntity' : `rename:${a.kind}`, a.id)
                  }
                >
                  {a.kind === 'entity' ? 'Редагувати реквізити' : 'Змінити назву'}
                </Button>
              </div>
            ))}
          </div>
          {data.capabilities.manage &&
            data.batches.map((b) => (
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
      {tab === 'operations' && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              className="min-h-11"
              disabled={!data.active || !data.capabilities.post}
              onClick={() => open('choose')}
            >
              ＋ Додати операцію
            </Button>
            {(!data.active || !data.capabilities.post) && (
              <p className="text-sm text-muted-foreground">
                {!data.active
                  ? 'Проведення буде доступне після погодження та активації обліку.'
                  : 'Ваша роль має доступ лише до перегляду.'}
              </p>
            )}
            {filter && (
              <Button variant="outline" onClick={() => setFilter('')}>
                Операції: {data.accounts.find((a) => a.id === filter)?.name} · Скинути ×
              </Button>
            )}
          </div>

          {data.drafts.length > 0 && (
            <section className="rounded-xl border p-4">
              <h2 className="text-lg font-semibold">Чернетки — не впливають на залишки</h2>
              {data.drafts.map((d) => (
                <article
                  key={d.id}
                  className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3"
                >
                  <span>
                    {dayLabel(d.date)} · {labels[d.kind]} · {moneyLabel(d.amount)} · {d.note}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {data.capabilities.draft && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          open(d.kind)
                          setEditingDraft(d.id)
                          setPreview({
                            amount: d.amount,
                            date: d.date,
                            sourceAccountId: d.sourceAccountId ?? '',
                            targetAccountId: d.targetAccountId ?? '',
                          })
                        }}
                      >
                        Редагувати
                      </Button>
                    )}
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
            <section
              id="unlinked-payments"
              className="scroll-mt-4 rounded-xl border border-amber-500 p-4"
            >
              <h2 className="font-semibold">Оплати без каси — потребують звірки</h2>
              <p className="text-sm">
                Ці оплати вже враховані в нарядах, але ще не включені в залишки кас.
              </p>
              {data.unlinked.map((p) => (
                <div key={p.id} className="mt-2 flex flex-wrap justify-between gap-2 border-t pt-2">
                  <span>
                    {dayLabel(p.date)} · {moneyLabel(p.amount)} · {p.provider || 'Оплата'}
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
            <p className="text-sm text-muted-foreground">Рухи до {dayLabel(data.asOf)} включно</p>
            <details className="my-4 rounded-lg border p-3" open>
              <summary className="min-h-11 cursor-pointer font-medium">
                Фільтри та період
                {filter || category || query || from || partyType || partyId
                  ? ' · застосовано'
                  : ''}
              </summary>
              <div className="my-3 flex flex-wrap gap-2">
                {['Сьогодні', 'Цей тиждень', 'Цей місяць'].map((label, i) => (
                  <Button
                    key={label}
                    variant="outline"
                    onClick={() => {
                      const start = new Date(today + 'T12:00:00Z')
                      if (i === 1)
                        start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7))
                      if (i === 2) start.setUTCDate(1)
                      setFrom(start.toISOString().slice(0, 10))
                      setDate(today)
                      void refresh(today)
                    }}
                  >
                    {label}
                  </Button>
                ))}
                <Button
                  variant="outline"
                  onClick={() => {
                    setFilter('')
                    setCategory('')
                    setQuery('')
                    setFrom('')
                    setPartyType('')
                    setPartyId('')
                    setDate(today)
                    void refresh(today)
                  }}
                >
                  Скинути фільтри
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="За конкретну дату">
                  <Input
                    type="date"
                    value={from === date ? date : ''}
                    onChange={(e) => {
                      if (e.target.value) {
                        setFrom(e.target.value)
                        setDate(e.target.value)
                        void refresh(e.target.value)
                      }
                    }}
                  />
                </Field>
                <Field label="Операції від">
                  <Input
                    type="date"
                    value={from}
                    max={date}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </Field>
                <Field label="Операції до">
                  <Input
                    type="date"
                    value={date}
                    min={from}
                    onChange={(e) => {
                      setDate(e.target.value)
                      if (e.target.value) void refresh(e.target.value)
                    }}
                  />
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
                <Field label="Тип контрагента">
                  <select
                    className={selectClass}
                    value={partyType}
                    onChange={(e) => {
                      setPartyType(e.target.value)
                      setPartyId('')
                    }}
                  >
                    <option value="">Усі контрагенти</option>
                    <option value="customer">Клієнти</option>
                    <option value="supplier">Постачальники</option>
                    <option value="other">Інші / без контрагента</option>
                  </select>
                </Field>
                <Field label="Контрагент">
                  <select
                    className={selectClass}
                    value={partyId}
                    onChange={(e) => setPartyId(e.target.value)}
                  >
                    <option value="">Усі за вибраним типом</option>
                    {parties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
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
            </details>
            <div
              className="hidden grid-cols-[1fr_2fr_1fr_auto] gap-3 border-b pb-3 text-sm text-muted-foreground lg:grid"
              aria-hidden="true"
            >
              <span>Дата / операція</span>
              <span>Призначення / рахунок</span>
              <span>Сума</span>
              <span>Деталі</span>
            </div>
            <div className="space-y-2">
              {groupMovements(rows).map((group) => {
                const e = group[0]
                const paired = group.length === 2
                const outgoing = group.find((r) => cents(r.amount) < BigInt('0'))
                const incoming = group.find((r) => cents(r.amount) > BigInt('0'))
                return (
                  <article
                    key={e.id}
                    className="grid gap-3 rounded-lg border p-3 lg:grid-cols-[1fr_2fr_1fr_auto] lg:items-start"
                  >
                    <div className="text-sm">
                      <p>{dayLabel(e.date)}</p>
                      <p className="font-medium">{labels[e.kind] || e.kind}</p>
                      <span
                        className={`mt-1 inline-block rounded border px-2 py-1 text-xs ${e.reversed ? 'border-amber-500' : ''}`}
                      >
                        {e.reversed ? 'Скасовано виправленням' : 'Проведено'}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="break-words font-medium">{e.counterparty || e.note}</p>
                      <p className="text-sm text-muted-foreground">
                        {paired
                          ? `${data.accounts.find((a) => a.id === outgoing?.accountId)?.name} → ${data.accounts.find((a) => a.id === incoming?.accountId)?.name}`
                          : data.accounts.find((a) => a.id === e.accountId)?.name}
                      </p>
                      {e.category && <p className="text-sm">{e.category}</p>}
                    </div>
                    <strong
                      className={
                        paired
                          ? ''
                          : cents(e.amount) < BigInt('0')
                            ? 'text-red-500'
                            : 'text-green-600'
                      }
                    >
                      {!paired && cents(e.amount) > BigInt('0') ? '+' : ''}
                      {moneyLabel(paired ? decimal(cents(incoming?.amount ?? '0')) : e.amount)}
                    </strong>
                    <details className="min-w-0 lg:max-w-64">
                      <summary className="flex min-h-11 cursor-pointer items-center rounded-md border px-3 text-sm">
                        Деталі та дії
                      </summary>
                      <div className="mt-3 space-y-3 text-sm">
                        <p className="break-words">{e.note}</p>
                        <p>Автор: {e.author}</p>
                        {group.map((r) => (
                          <p key={r.id}>
                            {data.accounts.find((a) => a.id === r.accountId)?.name}: залишок після
                            руху {moneyLabel(r.runningBalance)}
                          </p>
                        ))}
                        {e.link && (
                          <Link
                            className="inline-flex min-h-11 items-center rounded-md border px-3"
                            href={e.link}
                          >
                            {e.kind === 'supplier_payment'
                              ? 'Взаєморозрахунки постачальника →'
                              : 'Відкрити пов’язаний наряд →'}
                          </Link>
                        )}
                        {data.capabilities.reverse &&
                          !e.reversed &&
                          ['customer_payment', 'supplier_payment'].includes(e.kind) && (
                            <Button
                              variant="outline"
                              className="min-h-11"
                              onClick={() => open('refund', e.documentId)}
                            >
                              Повернути кошти
                            </Button>
                          )}
                        {data.capabilities.reverse &&
                          !e.reversed &&
                          !['opening', 'reversal', 'refund'].includes(e.kind) && (
                            <Button
                              variant="outline"
                              className="min-h-11 whitespace-normal"
                              onClick={() => open('reverse', e.documentId)}
                            >
                              Скасувати помилкову операцію
                            </Button>
                          )}
                      </div>
                    </details>
                  </article>
                )
              })}
              {!rows.length && (
                <p className="py-6 text-center text-muted-foreground">
                  Операцій за вибраними умовами немає.
                </p>
              )}
            </div>
          </section>
        </>
      )}
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
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-h-[90dvh]"
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>
              {modal.startsWith('rename:')
                ? 'Змінити назву'
                : labels[modal] ||
                  {
                    choose: 'Додати операцію',
                    postDraft: 'Провести чернетку',
                    discardDraft: 'Видалити чернетку',
                    access: 'Доступ ролі до каси',
                    archive: data.accounts.find((a) => a.id === selected)?.archived
                      ? 'Відновити рахунок'
                      : 'Архівувати рахунок',
                    entity: 'Власні реквізити',
                    editEntity: 'Редагувати реквізити компанії',
                    account: 'Нова каса / рахунок',
                    category: 'Стаття руху коштів',
                    opening: 'Початкові залишки',
                    activate: 'Активація обліку',
                    reverse: 'Скасувати помилкову операцію',
                    assign: 'Звірити оплату',
                  }[modal]}
            </DialogTitle>
          </DialogHeader>
          {modal === 'choose' ? (
            <div className="grid gap-3">
              <p className="text-sm text-muted-foreground">
                Оберіть призначення платежу. Оплата документа автоматично потрапить у касу.
              </p>
              <Link
                className="rounded-lg border p-4 font-medium hover:bg-accent"
                href="/work-orders"
              >
                Оплата від клієнта →
                <span className="mt-1 block text-sm font-normal text-muted-foreground">
                  Оберіть наряд і відкрийте його оплати
                </span>
              </Link>
              <Link
                className="rounded-lg border p-4 font-medium hover:bg-accent"
                href="/settlements"
              >
                Оплата постачальнику →
                <span className="mt-1 block text-sm font-normal text-muted-foreground">
                  Оберіть постачальника у взаєморозрахунках
                </span>
              </Link>
              {['income', 'expense', 'transfer'].map((kind) => (
                <Button
                  key={kind}
                  variant="outline"
                  className="min-h-12 justify-start whitespace-normal"
                  disabled={
                    !permittedAccounts.length ||
                    (kind === 'transfer' &&
                      (!data.capabilities.transfer || permittedAccounts.length < 2))
                  }
                  onClick={() => open(kind)}
                >
                  {labels[kind]}
                </Button>
              ))}
              {!permittedAccounts.length && (
                <p>Немає кас із правом проведення. Зверніться до адміністратора.</p>
              )}
            </div>
          ) : (
            <form
              onSubmit={submit}
              onChange={(e) =>
                setPreview(
                  Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<
                    string,
                    string
                  >
                )
              }
              className="space-y-4"
            >
              <fieldset disabled={busy} className="space-y-4">
                {(['entity', 'editEntity', 'account', 'category'].includes(modal) ||
                  modal.startsWith('rename:')) && (
                  <Field label="Назва">
                    <Input
                      name="name"
                      required
                      maxLength={150}
                      defaultValue={
                        modal === 'editEntity' || modal.startsWith('rename:')
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
                  <AccountAccessForm
                    accounts={accounts}
                    roles={data.roles}
                    access={data.accountAccess ?? []}
                  />
                )}
                {['entity', 'editEntity'].includes(modal) && (
                  <Field label="Код / податковий номер">
                    <Input
                      name="taxId"
                      maxLength={30}
                      defaultValue={
                        modal === 'editEntity'
                          ? (data.entities.find((e) => e.id === selected)?.taxId ?? '')
                          : ''
                      }
                    />
                  </Field>
                )}
                {modal === 'account' && (
                  <>
                    <Field label="Власний ФОП / компанія">
                      <select name="legalEntityId" required className={selectClass}>
                        {data.entities.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Тип">
                      <select
                        name="kind"
                        className={selectClass}
                        value={accountKind}
                        onChange={(e) => setAccountKind(e.target.value)}
                      >
                        <option value="cash">Готівкова каса</option>
                        <option value="bank">Банківський рахунок</option>
                      </select>
                    </Field>
                    {accountKind === 'bank' && (
                      <>
                        <Field label="IBAN">
                          <Input name="iban" />
                        </Field>
                        <label className="flex items-center gap-2">
                          <input type="checkbox" name="allowNegative" />
                          Дозволити від’ємний залишок банку
                        </label>
                      </>
                    )}
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
                    <Input
                      name="date"
                      type="date"
                      required
                      defaultValue={draft?.date ?? today}
                      max={today}
                    />
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
                    <Input
                      name="amount"
                      inputMode="decimal"
                      required
                      defaultValue={draft?.amount}
                      placeholder="0,00"
                    />
                  </Field>
                )}
                {['income', 'expense'].includes(modal) && (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Для інших рухів коштів, не пов’язаних з оплатою наряду чи постачальнику.
                    </p>
                    <Field label="Стаття">
                      <select
                        name="categoryId"
                        required
                        className={selectClass}
                        defaultValue={draft?.categoryId ?? ''}
                      >
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
                    <Field
                      label={
                        modal === 'expense'
                          ? 'Отримувач (необов’язково)'
                          : 'Від кого (необов’язково)'
                      }
                    >
                      <Input
                        name="counterpartyLabel"
                        defaultValue={draft?.counterpartyLabel ?? ''}
                      />
                    </Field>
                  </>
                )}
                {['income', 'expense', 'transfer', 'reverse', 'refund'].includes(modal) && (
                  <Field label={modal === 'reverse' ? 'Причина виправлення' : 'Призначення'}>
                    <Input name="note" required maxLength={1000} defaultValue={draft?.note} />
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
                    працівників. Активація змінить правила проведення нових оплат.
                  </p>
                )}
                {['reverse', 'refund'].includes(modal) && selectedDocument && (
                  <aside className="rounded-lg border border-amber-500 p-3 text-sm">
                    <p className="font-medium">
                      {selectedDocument.note} · {moneyLabel(selectedDocument.amount)}
                    </p>
                    <p>
                      {modal === 'refund'
                        ? 'Реальне повернення грошей. Буде створено окрему операцію та оновлено заборгованість.'
                        : 'Виправлення помилкового запису. Залишки буде змінено зворотною операцією; оригінал залишиться в історії.'}
                    </p>
                  </aside>
                )}
                {['income', 'expense', 'transfer'].includes(modal) && (
                  <aside
                    className="rounded-lg border bg-muted/30 p-3 text-sm"
                    aria-label="Підсумок операції"
                  >
                    <p className="font-medium">{labels[modal]}</p>
                    {(() => {
                      try {
                        const amount = cents(normalizeMoney(preview.amount || '0'))
                        if (amount <= BigInt('0'))
                          return <p>Вкажіть рахунок і суму, щоб переглянути підсумок.</p>
                        return (
                          <>
                            <p>{moneyLabel(decimal(amount))}</p>
                            {['sourceAccountId', 'targetAccountId'].map((field) => {
                              const a = accounts.find(
                                (account) =>
                                  account.id ===
                                  (preview[field] ??
                                    (modal === 'transfer' && field === 'targetAccountId'
                                      ? ''
                                      : contextAccount))
                              )
                              if (
                                !a ||
                                (modal === 'income' && field === 'sourceAccountId') ||
                                (modal === 'expense' && field === 'targetAccountId')
                              )
                                return null
                              const delta = field === 'sourceAccountId' ? -amount : amount
                              return (
                                <p key={field}>
                                  {a.name}:{' '}
                                  {knownBalance &&
                                  date === today &&
                                  (!preview.date || preview.date === today)
                                    ? `${moneyLabel(a.balance)} → ${moneyLabel(decimal(cents(a.balance) + delta))}`
                                    : `${delta > BigInt('0') ? '+' : ''}${moneyLabel(decimal(delta))}`}
                                </p>
                              )
                            })}
                            <p className="mt-2 text-muted-foreground">
                              Чернетка не змінює залишки. Проведення змінить залишки після
                              перевірки.
                            </p>
                          </>
                        )
                      } catch {
                        return <p>Вкажіть суму з точністю до копійки.</p>
                      }
                    })()}
                  </aside>
                )}
              </fieldset>
              {error && (
                <p
                  ref={errorRef}
                  tabIndex={-1}
                  role="alert"
                  className="rounded-md border border-destructive p-3 text-destructive"
                >
                  {error}
                </p>
              )}
              <div className="sticky bottom-0 flex flex-wrap gap-2 border-t bg-background py-4 [&_button]:min-h-11">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setModal('')}
                >
                  Скасувати
                </Button>
                {!editingDraft &&
                  ['income', 'expense', 'transfer'].includes(modal) &&
                  data.capabilities.draft && (
                    <Button type="submit" value="draft" variant="outline" disabled={busy}>
                      Зберегти чернетку
                    </Button>
                  )}
                <Button type="submit" className="flex-1" disabled={busy}>
                  {busy
                    ? 'Збереження…'
                    : editingDraft
                      ? 'Зберегти зміни чернетки'
                      : modal === 'opening'
                        ? 'Зберегти для погодження'
                        : modal === 'activate'
                          ? 'Підтвердити активацію'
                          : modal === 'postDraft'
                            ? 'Провести'
                            : modal === 'discardDraft'
                              ? 'Видалити чернетку'
                              : ['income', 'expense', 'transfer'].includes(modal)
                                ? modal === 'income'
                                  ? 'Провести надходження'
                                  : modal === 'expense'
                                    ? 'Провести витрату'
                                    : 'Провести переказ'
                                : modal === 'reverse'
                                  ? 'Підтвердити виправлення'
                                  : modal === 'refund'
                                    ? 'Провести повернення'
                                    : 'Зберегти'}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </main>
  )
}
