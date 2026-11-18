'use client'
import { useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowDownLeft, ArrowUpRight, ChevronRight, AlertTriangle } from 'lucide-react'
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
const zero = '0.00'
function total(parties: PartyRow[], key: 'debt' | 'advance' | 'overdue' | 'expected') {
  return decimal(
    parties.reduce((sum, p) => {
      const amount = cents(p[key])
      // A credit with one supplier cannot settle another supplier's bill.
      if (p.kind === 'supplier' && key === 'debt' && amount < 0) return sum
      return sum + amount
    }, BigInt(0))
  )
}
function balance(p: PartyRow) {
  return p.kind === 'supplier' ? cents(p.debt) : cents(p.debt) - cents(p.advance)
}
function Amount({ value }: { value: string | null }) {
  return <span className="tabular-nums">{value === null ? 'Не визначено' : moneyLabel(value)}</span>
}
export function SettlementDocument({ row }: { row: DocumentRow }) {
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
    ...(data.canSwitchCustomerScope ? ['review' as const] : []),
  ]
  const [view, setView] = useState<View>(
    available.includes(initialView as View) ? (initialView as View) : available[0]
  )
  const [customerScope, setCustomerScope] = useState(
    data.trackedParties === undefined ? 'legacy' : 'tracked'
  )
  const tracked =
    view === 'customer' &&
    (customerScope === 'tracked' ||
      (data.trackedParties !== undefined && !data.canSwitchCustomerScope))
  const sourceParties = tracked ? (data.trackedParties ?? []) : data.parties
  const reviewMap = new Map<string, PartyRow>()
  for (const p of [...data.parties, ...(data.trackedParties ?? [])]) {
    const key = p.kind + ':' + p.id
    const prior = reviewMap.get(key)
    reviewMap.set(key, prior ? { ...prior, documents: [...prior.documents, ...p.documents] } : p)
  }
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<PartyRow | null>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  const debtLabel = view === 'supplier' ? 'Загальний борг' : 'Заборгованість'
  const overdueLabel = view === 'supplier' ? 'Прострочено' : 'Прострочена заборгованість'
  const relevant = sourceParties.filter((p) => p.kind === view)
  const filtered =
    view === 'review'
      ? [...reviewMap.values()].filter((p) => p.documents.some((d) => d.reason))
      : relevant
          .filter((p) => balance(p) !== BigInt(0))
          .sort((a, b) => {
            const left = balance(a),
              right = balance(b)
            return left === right ? a.name.localeCompare(b.name, 'uk') : left > right ? -1 : 1
          })
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
    <div className="ops-workspace mx-auto w-full max-w-7xl space-y-5 p-4 pb-24 sm:p-6">
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
              setPage(1)
            }}
          >
            {tabs[v]}
            {v === 'review' ? ` (${issues})` : ''}
          </Button>
        ))}
      </nav>
      {view === 'customer' && data.canSwitchCustomerScope && data.trackedParties !== undefined && (
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
            <section className="grid gap-3 sm:grid-cols-3" aria-label="Підсумки вибірки">
              {[
                {
                  label:
                    view === 'customer'
                      ? tracked
                        ? 'Клієнти винні нам'
                        : 'Попередньо клієнти винні нам'
                      : 'Ми винні постачальникам',
                  value: total(relevant, 'debt'),
                  Icon: view === 'customer' ? ArrowDownLeft : ArrowUpRight,
                },
                {
                  label: 'Із них прострочено',
                  value: total(relevant, 'overdue'),
                  Icon: AlertTriangle,
                },
                {
                  label:
                    view === 'customer'
                      ? 'Аванси / переплати клієнтів'
                      : 'Наші аванси постачальникам',
                  value: total(relevant, 'advance'),
                  Icon: ArrowUpRight,
                },
              ].map((m) => (
                <div key={m.label} className="rounded-xl border bg-card p-4">
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <m.Icon className="size-4 shrink-0" aria-hidden="true" />
                    {m.label}
                  </p>
                  <p className="mt-2 break-words text-xl font-semibold tabular-nums">
                    <Amount value={m.value} />
                  </p>
                </div>
              ))}
            </section>
          )}
          {view === 'review' && (
            <p className="text-sm text-muted-foreground">
              Тут показано документи, які не включені до підсумків через відсутні або некоректні
              дані. Причину наведено біля кожного документа. Це не акт звірки: фактичні оплати
              потрібно перевірити за первинними документами.
            </p>
          )}
          {!shown.length ? (
            <p className="rounded-xl border p-8 text-center" role="status">
              {view === 'review'
                ? 'Документів для звірки немає.'
                : 'Немає контрагентів із ненульовим сальдо.'}
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
                    [overdueLabel, 'overdue'],
                  ].map(([label, key]) => (
                    <th key={key} scope="col" className="px-3 py-2 text-right first:text-left">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="block md:table-row-group">
                {shown.map((p) => {
                  const excluded = p.documents.filter((d) => d.reason).length
                  return (
                    <tr
                      key={p.id}
                      aria-label={p.name}
                      className="relative grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 border-t px-3 py-2 hover:bg-muted/40 focus-within:bg-muted/40 md:table-row"
                    >
                      <td className="min-w-0 break-words font-medium md:px-3 md:py-2">
                        {p.id === 'unassigned' ? (
                          <button
                            onClick={(e) => {
                              opener.current = e.currentTarget
                              setSelected(p)
                            }}
                          >
                            {p.name}
                          </button>
                        ) : (
                          <Link
                            className="text-left underline after:absolute after:inset-0"
                            href={`/${p.kind === 'supplier' ? 'suppliers' : 'customers'}/${encodeURIComponent(p.id)}?date=${data.asOf}#settlement-documents`}
                          >
                            {p.name}
                          </Link>
                        )}
                        {p.archived && <small> · Архівний</small>}
                        {excluded > 0 && (
                          <small className="block font-normal text-amber-600">
                            Не враховано в підсумках: {excluded}
                          </small>
                        )}
                      </td>
                      <td className="text-right font-semibold md:px-3">
                        <small className="mr-1 md:hidden">{debtLabel}</small>
                        <Amount value={decimal(balance(p))} />
                      </td>
                      <td className="col-span-2 text-right md:px-3">
                        <small className="mr-1 md:hidden">{overdueLabel}</small>
                        <Amount value={p.overdue} />
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
                <SettlementDocument key={d.id} row={d} />
              ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
