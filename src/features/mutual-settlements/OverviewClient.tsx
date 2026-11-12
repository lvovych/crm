'use client'
import { useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowDownLeft, ArrowUpRight, Search, ChevronRight, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { cents, decimal } from '@/features/finance/money'
import { moneyLabel, dayLabel } from '@/features/finance/presentation'
import type { Overview, PartyRow, DocumentRow } from './types'

type View = 'customer' | 'supplier' | 'review'
const PAGE_SIZE = 25
const selectClass = 'min-h-11 w-full rounded-md border bg-background px-3 text-sm'
const zero = '0.00'
function total(parties: PartyRow[], key: 'debt' | 'advance' | 'overdue' | 'expected') {
  return decimal(parties.reduce((sum, p) => sum + cents(p[key]), BigInt(0)))
}
function matches(p: PartyRow, query: string) {
  const q = query.trim().toLocaleLowerCase('uk')
  const digits = q.replace(/\D/g, '')
  return (
    !q ||
    `${p.name} ${p.phone} ${p.documents.map((d) => d.label).join(' ')}`
      .toLocaleLowerCase('uk')
      .includes(q) ||
    (digits.length >= 3 && /^[+\d\s()\-]+$/.test(q) && p.phone.replace(/\D/g, '').includes(digits))
  )
}
function Amount({ value }: { value: string | null }) {
  return <span className="tabular-nums">{value === null ? 'Не визначено' : moneyLabel(value)}</span>
}
function Document({ row }: { row: DocumentRow }) {
  return (
    <article className="rounded-lg border p-4" aria-label={row.label}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="break-words font-semibold">{row.label}</h3>
          <p className="text-sm text-muted-foreground">
            {row.date ? dayLabel(row.date) : 'Дата уточнюється'} ·{' '}
            {row.due ? `Оплатити до ${dayLabel(row.due)}` : 'Строк оплати не визначено'}
          </p>
        </div>
        <Button asChild variant="outline" className="min-h-11">
          <Link href={row.href}>
            Відкрити документ <ChevronRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
      {row.reason ? (
        <p className="my-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          {row.reason} Не включено до підсумків.
        </p>
      ) : null}
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Сума документа</dt>
          <dd>
            <Amount value={row.amount} />
          </dd>
        </div>
        {row.paid !== null && (
          <div>
            <dt className="text-muted-foreground">Оплати за записами</dt>
            <dd>
              <Amount value={row.paid} />
            </dd>
          </div>
        )}
        {!row.reason && (
          <>
            <div>
              <dt className="text-muted-foreground">
                {row.provisional ? 'Попередній борг' : 'Борг'}
              </dt>
              <dd>
                <Amount value={row.debt} />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Аванс / переплата</dt>
              <dd>
                <Amount value={row.advance} />
              </dd>
            </div>
            {row.expected !== zero && (
              <div>
                <dt className="text-muted-foreground">Очікувана сума в роботі</dt>
                <dd>
                  <Amount value={row.expected} />
                </dd>
              </div>
            )}
          </>
        )}
      </dl>
      {row.history && (
        <details className="mt-4 rounded-lg border p-3">
          <summary className="min-h-11 cursor-pointer font-medium">
            Історія зобов’язань і оплат ({row.history.length})
          </summary>
          <ol className="mt-3 space-y-3" aria-label="Історія документа">
            {row.history.map((event) => (
              <li key={event.id} className="border-t pt-3 text-sm">
                <p className="font-medium">
                  {(
                    {
                      created: 'Створено наряд',
                      completed: 'Виникло зобов’язання',
                      adjusted: 'Змінено суму або умови',
                      status_changed: 'Змінено статус',
                      cancelled: 'Скасовано зобов’язання',
                      payment: 'Отримано оплату',
                      payment_reversed: 'Сторновано запис оплати',
                      refund: 'Повернення клієнту',
                      deleted: 'Видалено порожній наряд',
                    } as Record<string, string>
                  )[event.kind] ?? event.kind}{' '}
                  · {dayLabel(event.date)}
                </p>
                <p>
                  Зміна зобов’язання: <Amount value={event.chargeDelta} /> · Зміна оплат:{' '}
                  <Amount value={event.paidDelta} />
                </p>
                <p className="text-muted-foreground">
                  {event.actor ?? 'Система / автор не зафіксований'} · Зареєстровано{' '}
                  {event.recordedAt.replace('T', ' ').replace('Z', ' UTC')}
                </p>
                {event.sourceDate && event.sourceDate !== event.date && (
                  <p>Дата первинної оплати: {dayLabel(event.sourceDate)}</p>
                )}
                {event.manualPaid && (
                  <p>Ручна позначка «Оплачено» не замінює фактичну оплату й не зменшує борг.</p>
                )}
                {event.note && <p className="break-words">{event.note}</p>}
              </li>
            ))}
          </ol>
        </details>
      )}
    </article>
  )
}
export function OverviewClient({ data, initialView }: { data: Overview; initialView?: string }) {
  const available: View[] = [
    ...(data.customersAllowed ? ['customer' as const] : []),
    ...(data.suppliersAllowed ? ['supplier' as const] : []),
    'review',
  ]
  const [view, setView] = useState<View>(
    available.includes(initialView as View) ? (initialView as View) : available[0]
  )
  const [customerScope, setCustomerScope] = useState(
    data.trackedParties === undefined ? 'legacy' : 'tracked'
  )
  const tracked = view === 'customer' && customerScope === 'tracked'
  const sourceParties = tracked ? (data.trackedParties ?? []) : data.parties
  const reviewMap = new Map<string, PartyRow>()
  for (const p of [...data.parties, ...(data.trackedParties ?? [])]) {
    const key = p.kind + ':' + p.id
    const prior = reviewMap.get(key)
    reviewMap.set(key, prior ? { ...prior, documents: [...prior.documents, ...p.documents] } : p)
  }
  const [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all'),
    [sort, setSort] = useState('debt'),
    [page, setPage] = useState(1)
  const [selected, setSelected] = useState<PartyRow | null>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const debtLabel = view === 'supplier' ? 'Ми винні' : tracked ? 'Клієнт винен' : 'Попередній борг'
  const advanceLabel = view === 'supplier' ? 'Наш аванс' : 'Аванс клієнта'
  const relevant = (view === 'review' ? [...reviewMap.values()] : sourceParties).filter(
    (p) =>
      (view === 'review' ? p.documents.some((d) => d.reason) : p.kind === view) && matches(p, query)
  )
  const filtered = relevant
    .filter(
      (p) =>
        filter === 'all' ||
        (filter === 'review'
          ? p.documents.some((d) => d.reason)
          : cents(p[filter as 'debt' | 'overdue' | 'advance']) > 0)
    )
    .sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name, 'uk')
        : cents(a[sort as 'debt' | 'overdue']) === cents(b[sort as 'debt' | 'overdue'])
          ? a.name.localeCompare(b.name, 'uk')
          : cents(a[sort as 'debt' | 'overdue']) > cents(b[sort as 'debt' | 'overdue'])
            ? -1
            : 1
    )
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)),
    currentPage = Math.min(page, pages)
  const shown = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const issues = [...reviewMap.values()].reduce(
    (n, p) => n + p.documents.filter((d) => d.reason).length,
    0
  )
  const unavailable = view === 'customer' && !tracked && data.customersHistoricalUnavailable
  const supplierFailed = view === 'supplier' && !!data.supplierError
  const tabs = {
    customer: 'Клієнти',
    supplier: 'Постачальники',
    review: 'Не враховано в підсумках',
  }
  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 p-4 pb-24 sm:p-6">
      <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <h1 className="text-2xl font-semibold">Взаєморозрахунки</h1>
          <p className="mt-1 text-muted-foreground">Хто винен нам і кому винні ми</p>
        </div>
        <form className="flex flex-wrap items-end gap-2" aria-label="Дата взаєморозрахунків">
          <input type="hidden" name="view" value={view} />
          <label className="min-w-0 flex-1 text-sm">
            Станом на
            <Input
              className="mt-1 min-h-11"
              type="date"
              name="date"
              defaultValue={data.asOf}
              max={data.today}
              required
            />
          </label>
          <Button type="submit" variant="outline" className="min-h-11">
            Показати
          </Button>
        </form>
      </header>
      <nav className="flex flex-wrap items-center gap-2" aria-label="Розділи взаєморозрахунків">
        {available.map((v) => (
          <Button
            key={v}
            aria-pressed={view === v}
            variant={view === v ? 'default' : v === 'review' ? 'link' : 'outline'}
            className="h-auto min-h-11 whitespace-normal px-2 py-2"
            onClick={() => {
              setView(v)
              setFilter('all')
              setPage(1)
            }}
          >
            {tabs[v]}
            {v === 'review' ? ` (${issues})` : ''}
          </Button>
        ))}
      </nav>
      {view === 'customer' && data.trackedParties !== undefined && (
        <section aria-label="Область клієнтського обліку" className="grid grid-cols-2 gap-2">
          <Button
            variant={tracked ? 'default' : 'outline'}
            className="h-auto min-h-11 whitespace-normal"
            aria-pressed={tracked}
            onClick={() => {
              setCustomerScope('tracked')
              setPage(1)
              setSelected(null)
            }}
          >
            Новий облік з історією
          </Button>
          <Button
            variant={!tracked ? 'default' : 'outline'}
            className="h-auto min-h-11 whitespace-normal"
            aria-pressed={!tracked}
            onClick={() => {
              setCustomerScope('legacy')
              setPage(1)
              setSelected(null)
            }}
          >
            Старі документи · попередні суми
          </Button>
        </section>
      )}
      {tracked && (
        <p className="rounded-lg border p-4 text-sm">
          Тільки документи нового обліку. Історія показана за датою реєстрації операцій; оплати
          майбутньою датою враховуються з цієї дати. Старі документи та їхні суми показані окремо.
          Аванси різних нарядів не зараховуються автоматично.
        </p>
      )}
      {view === 'customer' && !tracked && !unavailable && (
        <aside
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm"
          role="note"
        >
          <strong>Клієнтські суми попередні.</strong>
          <details className="mt-2">
            <summary className="cursor-pointer underline underline-offset-4">
              Як розраховано суми
            </summary>
            <p className="mt-2">
              Розраховано за поточними завершеними нарядами та записами оплат. Наряди в роботі
              показано окремо. Для авто клієнт може визначатися за поточним власником; історичного
              підтвердження ще немає. Борг і аванс між різними нарядами не згортаються автоматично.
            </p>
          </details>
        </aside>
      )}
      {unavailable && (
        <div className="rounded-xl border p-5" role="status">
          <h2 className="font-semibold">Історичний клієнтський борг поки недоступний</h2>
          <p className="my-2 text-sm text-muted-foreground">
            Старі наряди не містять повної історії змін сум і клієнтів. Щоб не показувати
            недостовірний залишок, огляд старих нарядів доступний лише на сьогодні.
          </p>
          <Button asChild variant="outline">
            <Link href="/mutual-settlements?view=customer">Показати на сьогодні</Link>
          </Button>
        </div>
      )}
      {data.supplierError && view !== 'customer' && (
        <p role="alert" className="rounded-lg border border-destructive p-4">
          {data.supplierError} Дані постачальників не включено; підсумок неповний.
        </p>
      )}
      {view === 'review' && data.customersHistoricalUnavailable && (
        <p role="note" className="rounded-lg border p-4">
          На цю дату старі клієнтські документи недоступні. Тут показано документи нового
          клієнтського обліку та доступні документи постачальників.
        </p>
      )}
      {!unavailable && !supplierFailed && (
        <>
          {view !== 'review' && (
            <section
              className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg border px-3 py-2"
              aria-label="Підсумки вибірки"
            >
              {[
                {
                  label:
                    view === 'customer'
                      ? tracked
                        ? 'Клієнти винні нам'
                        : 'Попередньо клієнти винні нам'
                      : 'Ми винні постачальникам',
                  value: total(filtered, 'debt'),
                  Icon: view === 'customer' ? ArrowDownLeft : ArrowUpRight,
                },
                {
                  label: 'Із них прострочено',
                  value: total(filtered, 'overdue'),
                  Icon: AlertTriangle,
                },
                {
                  label:
                    view === 'customer'
                      ? 'Аванси / переплати клієнтів'
                      : 'Наші аванси постачальникам',
                  value: total(filtered, 'advance'),
                  Icon: ArrowUpRight,
                },
              ].map((m) => (
                <div key={m.label} className="flex flex-wrap items-baseline gap-x-2">
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <m.Icon className="size-4 shrink-0" aria-hidden="true" />
                    {m.label}
                  </p>
                  <p className="break-words font-semibold">
                    <Amount value={m.value} />
                  </p>
                </div>
              ))}
            </section>
          )}
          {view === 'customer' && (
            <p className="text-sm text-muted-foreground">
              Очікувана сума нарядів у роботі: <Amount value={total(filtered, 'expected')} />. Не
              включена до боргу.
            </p>
          )}
          {view === 'supplier' && (
            <p className="text-sm text-muted-foreground">
              Борг за облікованими документами. Незвірені накладні не включено. Аванси показано
              окремо від боргу.
            </p>
          )}
          {view === 'review' && (
            <p className="text-sm text-muted-foreground">
              Тут показано документи, які не включені до підсумків через відсутні або некоректні
              дані. Причину наведено біля кожного документа. Це не акт звірки: фактичні оплати
              потрібно перевірити за первинними документами.
            </p>
          )}
          <section className="rounded-xl border p-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-[minmax(0,1fr)_200px_200px]">
              <label className="col-span-2 text-sm md:col-span-1">
                Пошук
                <div className="relative mt-1">
                  <Search
                    className="absolute left-3 top-3 size-5 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    className="min-h-11 pl-10"
                    placeholder="Ім’я, назва, телефон або документ"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value)
                      setPage(1)
                    }}
                  />
                </div>
              </label>
              <Button
                type="button"
                variant="outline"
                aria-expanded={filtersOpen}
                className="col-span-2 md:hidden"
                onClick={() => setFiltersOpen(!filtersOpen)}
              >
                Фільтри{filter !== 'all' ? ' (1)' : ''}
              </Button>
              <label className={filtersOpen ? 'text-sm' : 'hidden text-sm md:block'}>
                Показати
                <select
                  aria-label="Показати контрагентів"
                  className={selectClass + ' mt-1'}
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value)
                    setPage(1)
                  }}
                >
                  <option value="all">Усіх</option>
                  <option value="debt">З боргом</option>
                  <option value="overdue">З простроченням</option>
                  <option value="advance">З авансом</option>
                  <option value="review">Не враховано в підсумках</option>
                </select>
              </label>
              <label className={filtersOpen ? 'text-sm' : 'hidden text-sm md:block'}>
                Сортування
                <select
                  className={selectClass + ' mt-1'}
                  value={sort}
                  onChange={(e) => {
                    setSort(e.target.value)
                    setPage(1)
                  }}
                >
                  <option value="debt">Найбільший борг</option>
                  <option value="overdue">Найбільше прострочено</option>
                  <option value="name">За назвою</option>
                </select>
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p role="status" className="text-sm text-muted-foreground">
                Знайдено контрагентів: {filtered.length}. Підсумки враховують поточні фільтри.
              </p>
              <Button
                variant="ghost"
                className="min-h-11"
                onClick={() => {
                  setQuery('')
                  setFilter('all')
                  setSort('debt')
                  setPage(1)
                }}
              >
                Скинути фільтри
              </Button>
            </div>
          </section>
          {!shown.length ? (
            <p className="rounded-xl border p-8 text-center" role="status">
              За цими умовами документів не знайдено.
            </p>
          ) : view !== 'review' ? (
            <table
              className="block w-full overflow-hidden rounded-lg border text-sm md:table"
              aria-label="Взаєморозрахунки за контрагентами"
            >
              <thead className="hidden bg-muted/40 text-muted-foreground md:table-header-group">
                <tr>
                  {[
                    [view === 'supplier' ? 'Постачальник' : 'Клієнт', 'name'],
                    [debtLabel, 'debt'],
                    ['Із них прострочено', 'overdue'],
                  ].map(([label, key]) => (
                    <th
                      key={key}
                      scope="col"
                      className="px-3 py-2 text-right first:text-left"
                      aria-sort={
                        sort === key ? (key === 'name' ? 'ascending' : 'descending') : 'none'
                      }
                    >
                      <button
                        onClick={() => {
                          setSort(key)
                          setPage(1)
                        }}
                      >
                        {label} {sort === key && (key === 'name' ? '↑' : '↓')}
                      </button>
                    </th>
                  ))}
                  <th className="px-3 text-right">{advanceLabel}</th>
                  <th className="px-3 text-right">Документи</th>
                </tr>
              </thead>
              <tbody className="block md:table-row-group">
                {shown.map((p) => {
                  const advanceOnly = p.debt === zero && p.advance !== zero
                  const excluded = p.documents.filter((d) => d.reason).length
                  return (
                    <tr
                      key={p.id}
                      aria-label={p.name}
                      className="relative grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 border-t px-3 py-2 hover:bg-muted/40 focus-within:bg-muted/40 md:table-row"
                      onClick={(e) => {
                        opener.current = e.currentTarget.querySelector('button')
                        setSelected(p)
                      }}
                    >
                      <td className="min-w-0 break-words font-medium md:px-3 md:py-2">
                        {p.name}
                        {p.archived && <small> · Архівний</small>}
                        {excluded > 0 && (
                          <small className="block font-normal text-amber-600">
                            Не враховано в підсумках: {excluded}
                          </small>
                        )}
                      </td>
                      <td
                        className={`text-right font-semibold md:px-3 ${advanceOnly ? 'hidden md:table-cell' : ''}`}
                      >
                        <small className="mr-1 md:hidden">{debtLabel}</small>
                        <Amount value={p.debt} />
                      </td>
                      <td
                        className={`text-right md:px-3 ${p.overdue === zero ? 'hidden md:table-cell' : 'col-span-2'}`}
                      >
                        <small className="mr-1 md:hidden">Прострочено</small>
                        {p.overdue === zero ? '—' : <Amount value={p.overdue} />}
                      </td>
                      <td
                        className={`text-right md:px-3 ${p.advance === zero ? 'hidden md:table-cell' : advanceOnly ? 'font-semibold' : 'col-span-2'}`}
                      >
                        <small className="mr-1 md:hidden">{advanceLabel}</small>
                        {p.advance === zero ? '—' : <Amount value={p.advance} />}
                      </td>
                      <td className="col-span-2 text-right md:px-3">
                        <button
                          type="button"
                          aria-label={`Документи: ${p.name}`}
                          className="inline-flex items-center gap-1 text-xs md:text-sm"
                        >
                          <span className="md:hidden">Документи</span>
                          {p.documents.length}
                          <ChevronRight className="size-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <div className="space-y-3">
              {shown.map((p) => (
                <article
                  key={`${p.kind}:${p.id}`}
                  className="rounded-xl border bg-card p-4"
                  aria-label={p.name}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="break-words text-lg font-semibold">{p.name}</h2>
                      <p className="text-sm text-muted-foreground">
                        {p.kind === 'customer' ? 'Клієнт' : 'Постачальник'}
                        {p.phone ? ` · ${p.phone}` : ''}
                        {p.archived ? ' · Архівний' : ''}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      className="min-h-11 w-full sm:w-auto"
                      onClick={(e) => {
                        opener.current = e.currentTarget
                        setSelected(p)
                      }}
                      aria-label={`Документи: ${p.name}`}
                    >
                      Документи ({p.documents.length}) <ChevronRight aria-hidden="true" />
                    </Button>
                  </div>
                  {p.documents.some((d) => d.reason) && (
                    <p className="mt-3 rounded-md bg-amber-500/10 p-2 text-sm">
                      Не враховано в підсумках: {p.documents.filter((d) => d.reason).length}{' '}
                      документів. Не включені до сум.
                    </p>
                  )}
                  {view === 'review' && (
                    <ul className="mt-3 space-y-2 text-sm">
                      {p.documents
                        .filter((d) => d.reason)
                        .map((d) => (
                          <li key={d.id} className="border-t pt-2">
                            <strong>{d.label}</strong> · <Amount value={d.amount} />
                            <p className="text-muted-foreground">{d.reason}</p>
                          </li>
                        ))}
                    </ul>
                  )}
                </article>
              ))}
            </div>
          )}
          {pages > 1 && (
            <nav
              className="flex items-center justify-center gap-3"
              aria-label="Сторінки контрагентів"
            >
              <Button
                variant="outline"
                disabled={currentPage === 1}
                onClick={() => setPage(currentPage - 1)}
              >
                Назад
              </Button>
              <span>
                {currentPage} / {pages}
              </span>
              <Button
                variant="outline"
                disabled={currentPage === pages}
                onClick={() => setPage(currentPage + 1)}
              >
                Далі
              </Button>
            </nav>
          )}
        </>
      )}
      <Sheet
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      >
        <SheetContent
          className="w-full overflow-y-auto p-4 sm:max-w-2xl"
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            opener.current?.focus({ preventScroll: true })
          }}
        >
          <SheetHeader>
            <SheetTitle className="break-words pr-6">{selected?.name}</SheetTitle>
            <SheetDescription>
              {selected?.phone && `${selected.phone} · `}Документи на {dayLabel(data.asOf)}.{' '}
              {selected?.kind === 'customer'
                ? selected.documents.some((d) => d.history)
                  ? 'Зобов’язання й оплати з історією. Старі документи позначено окремо.'
                  : 'Попередній розрахунок, без історичного підтвердження.'
                : 'За даними чинного обліку постачальників.'}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-3">
            {selected?.documents
              .filter((d) => view !== 'review' || d.reason)
              .map((d) => (
                <Document key={d.id} row={d} />
              ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
