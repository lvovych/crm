'use client'
import { SalaryPayment } from './SalaryPayment'
import { AdjustmentFields } from './AdjustmentFields'
import { adjustmentsSchema, snapshotAdjustments, type SalaryAdjustment } from './adjustments'
import { periodPresets, presetPeriod, type PeriodPreset } from './period-presets'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CalendarCheck, Calculator, Check, ChevronLeft, Plus, RefreshCw } from 'lucide-react'
import { DocumentHeader, DocumentStatus } from '@/components/operations/document-ui'
import { Lines, type SlipDetails } from './Lines'
import { rulesAt } from './commission-rules'
import { zonedDayKey } from '@/lib/timezone'
import type { CommissionDetails } from './commission-calculator'
import { CommissionLines, payrollMoney as money } from './CommissionLines'
import {
  IndividualRules,
  payrollButton as button,
  payrollPrimary as primary,
  payrollField as field,
  payrollControl as control,
} from './IndividualRules'
import {
  payrollWorkspace,
  previewDocument,
  saveSalaryDocument,
  postSalaryDocument,
} from './document-actions'

type Workspace = NonNullable<Awaited<ReturnType<typeof payrollWorkspace>>['data']>
type SalaryDocument = Workspace['documents'][number]
const day = (value: string) => value.split('-').reverse().join('.')
const shortNumber = (id: string) => `ЗП-${id.slice(-8).toUpperCase()}`
function Condition({ start, end }: { start?: string; end?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-emerald-600/20 bg-emerald-500/5 p-4 text-sm">
      <CalendarCheck className="mt-0.5 size-4 shrink-0" />
      <div>
        <strong>Тільки закриті наряди</strong>
        <p className="mt-1 text-muted-foreground">
          {start && end
            ? `Дата закриття: ${day(start)} — ${day(end)} включно.`
            : 'Дата закриття входить у вибраний період включно з обома датами.'}{' '}
          За часом автосервісу. Дата оплати не впливає на відбір.
        </p>
      </div>
    </div>
  )
}
export function PayrollWorkspace({
  data,
  initial,
}: {
  data: Workspace
  initial: { mode?: string; employee?: string; slip?: string }
}) {
  const router = useRouter(),
    today = zonedDayKey(new Date(), data.zone)
  const initialDoc = data.documents.find((d) => d.id === initial.slip)
  const [view, setView] = useState(
    initial.slip
      ? 'document'
      : initial.mode === 'rules'
        ? 'rules'
        : initial.mode === 'new'
          ? 'create'
          : 'journal'
  )
  const [employee, setEmployee] = useState(
    initialDoc?.employee || initial.employee || data.people[0]?.id || ''
  )
  const [preset, setPreset] = useState<PeriodPreset | ''>('')
  const [adjustments, setAdjustments] = useState<SalaryAdjustment[]>(
    snapshotAdjustments(initialDoc?.details)
  )
  const [selected, setSelected] = useState<SalaryDocument | null>(initialDoc ?? null)
  const [start, setStart] = useState(initialDoc?.start || today.slice(0, 8) + '01'),
    [end, setEnd] = useState(initialDoc?.end || today),
    [date, setDate] = useState(initialDoc?.date || today)
  const [preview, setPreview] = useState<NonNullable<
    Awaited<ReturnType<typeof previewDocument>>['data']
  > | null>(null)
  const [requestId, setRequestId] = useState('')
  const [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [pending, run] = useTransition()
  const [filter, setFilter] = useState('all'),
    [status, setStatus] = useState('all')
  const [showArchive, setShowArchive] = useState(false)
  const selectablePeople = data.people.filter((p) => showArchive || p.active || p.id === employee)
  const person = data.people.find((p) => p.id === employee)
  const navigate = (next: string) => {
    setView(next)
    setError('')
    setMessage('')
  }
  function newDocument() {
    setSelected(null)
    setAdjustments([])
    setPreset('')
    setPreview(null)
    setRequestId(crypto.randomUUID())
    navigate('create')
  }
  function openDocument(doc: SalaryDocument) {
    setSelected(doc)
    setAdjustments(snapshotAdjustments(doc.details))
    setPreset('')
    setEmployee(doc.employee)
    setStart(doc.start)
    setEnd(doc.end)
    setDate(doc.date)
    setPreview(null)
    navigate('document')
  }
  function recalculate() {
    run(async () => {
      setError('')
      const parsed = adjustmentsSchema.safeParse(adjustments)
      if (!parsed.success) {
        setError(parsed.error.issues[0].message)
        return
      }
      const result = await previewDocument({
        employee,
        start,
        end,
        ...(parsed.data.length ? { adjustments: parsed.data } : {}),
      })
      if (!result.data) {
        setError(result.error || 'Не вдалося розрахувати зарплату.')
        return
      }
      setPreview(result.data)
      if (!selected && !requestId) setRequestId(crypto.randomUUID())
      navigate('document')
    })
  }
  function save(post: boolean) {
    run(async () => {
      setError('')
      let id = selected?.id,
        revision = selected?.revision
      if (preview) {
        const result = await saveSalaryDocument({
          id: selected?.id || requestId,
          existing: !!selected,
          revision: selected?.revision,
          employee,
          start,
          end,
          date,
          preview: preview.fingerprint,
          ...(preview.details.adjustments?.length
            ? { adjustments: preview.details.adjustments }
            : {}),
        })
        if (!result.data) {
          setError(result.error || 'Не вдалося зберегти.')
          return
        }
        id = result.data.id
        revision = result.data.revision
        setSelected({
          id,
          employee,
          start,
          end,
          date,
          status: 'new',
          total: preview.details.total,
          details: preview.details,
          revision,
          createdAt: new Date().toISOString(),
        })
        setPreview(null)
      }
      if (post && id && revision) {
        const result = await postSalaryDocument({ id, revision })
        if (!result.data) {
          setError(result.error || 'Не вдалося провести.')
          router.refresh()
          return
        }
        setSelected((current) => (current ? { ...current, status: 'completed' } : current))
      }
      setMessage(post ? 'Нарахування проведено. Суми зафіксовано.' : 'Чернетку збережено.')
      router.refresh()
    })
  }
  const details = preview?.details || selected?.details
  const v2 =
    details &&
    !Array.isArray(details) &&
    typeof details === 'object' &&
    'version' in details &&
    details.version === 2
      ? (details as unknown as CommissionDetails)
      : null
  const posted = selected?.status === 'completed'
  const panel = 'rounded-xl border bg-card p-5 sm:p-6'
  const docs = data.documents.filter(
    (d) => (filter === 'all' || d.employee === filter) && (status === 'all' || d.status === status)
  )
  return (
    <main className="ops-workspace mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-7">
      <nav className="flex flex-wrap gap-6 border-b" aria-label="Зарплати">
        {[
          ['journal', 'Документи нарахування'],
          ['rules', 'Правила працівників'],
        ].map(([key, label]) => (
          <button
            key={key}
            disabled={pending}
            onClick={() => navigate(key)}
            className={`min-h-12 border-b-2 text-sm ${(view === 'rules') === (key === 'rules') ? 'border-primary font-semibold' : 'border-transparent text-muted-foreground'}`}
          >
            {label}
          </button>
        ))}
      </nav>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="rounded-lg border p-4 text-sm">
          {message}
        </p>
      )}
      {view !== 'journal' && view !== 'document' && (
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={showArchive}
            onChange={(e) => setShowArchive(e.target.checked)}
          />
          Показати також архівних працівників
        </label>
      )}
      {!data.people.length ? (
        <Link href="/employees" className={button}>
          Додайте працівника
        </Link>
      ) : (
        <>
          {view === 'journal' && (
            <>
              <DocumentHeader
                title="Документи нарахування"
                description="Один документ — один працівник і вибраний період."
                actions={
                  data.canManage && (
                    <button className={primary} onClick={newDocument}>
                      <Plus className="size-4" />
                      Створити нарахування
                    </button>
                  )
                }
              />
              <div className="flex flex-wrap gap-4">
                <label className={field}>
                  Працівник
                  <select
                    aria-label="Працівник"
                    className={control}
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="all">Усі працівники</option>
                    {data.people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.crmRole ? ` · ${p.crmRole}` : ''}
                        {!p.active ? ' · архів' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={field}>
                  Статус
                  <select
                    aria-label="Статус"
                    className={control}
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    <option value="all">Усі документи</option>
                    <option value="new">Чернетки</option>
                    <option value="completed">Проведені</option>
                  </select>
                </label>
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full whitespace-nowrap text-left text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      {[
                        'Документ / дата',
                        'Працівник',
                        'Період нарахування',
                        'Статус',
                        'Нараховано, грн',
                      ].map((t) => (
                        <th key={t} className="p-4 last:text-right">
                          {t}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {docs.map((d) => (
                      <tr key={d.id} className="border-t">
                        <td className="p-4">
                          <button
                            className="font-semibold underline"
                            onClick={() => openDocument(d)}
                          >
                            {shortNumber(d.id)}
                          </button>
                          <span className="block text-xs text-muted-foreground">{day(d.date)}</span>
                        </td>
                        <td className="p-4">
                          {data.people.find((p) => p.id === d.employee)?.name}
                        </td>
                        <td className="p-4">
                          {day(d.start)} — {day(d.end)}
                        </td>
                        <td className="p-4">
                          <DocumentStatus tone={d.status === 'completed' ? 'success' : 'neutral'}>
                            {d.status === 'completed' ? 'Проведено' : 'Чернетка'}
                          </DocumentStatus>
                        </td>
                        <td className="p-4 text-right font-semibold tabular-nums">
                          {money(d.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!docs.length && (
                  <p className="p-8 text-center text-muted-foreground">
                    Документів за вибраними умовами немає.
                  </p>
                )}
              </div>
              <Condition />
            </>
          )}
          {view === 'create' && (
            <>
              <button
                className="flex items-center gap-1 text-sm"
                onClick={() => navigate('journal')}
              >
                <ChevronLeft className="size-4" />
                До документів
              </button>
              <DocumentHeader
                title="Нарахування зарплати"
                description="Оберіть працівника й період. Документ заповнюється за індивідуальними правилами."
              />
              <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
                <form
                  className={panel + ' space-y-5'}
                  onSubmit={(e) => {
                    e.preventDefault()
                    recalculate()
                  }}
                >
                  <h2 className="text-lg font-semibold">Працівник і період</h2>
                  <fieldset disabled={pending} className="space-y-5">
                    <label className={field}>
                      Працівник
                      <select
                        aria-label="Працівник"
                        required
                        className={control}
                        value={employee}
                        onChange={(e) => {
                          setEmployee(e.target.value)
                          setPreview(null)
                        }}
                      >
                        {selectablePeople.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                            {p.crmRole ? ` · ${p.crmRole}` : ''}
                            {!p.active ? ' · архів' : ''}
                            {p.dismissed ? ' · звільнено' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={field}>
                      Швидкий вибір періоду (необов’язково)
                      <select
                        className={control}
                        value={preset}
                        onChange={(e) => {
                          const value = e.target.value as PeriodPreset | ''
                          setPreset(value)
                          if (value) {
                            const range = presetPeriod(value, today)
                            setStart(range.start)
                            setEnd(range.end)
                            setPreview(null)
                          }
                        }}
                      >
                        <option value="">Власні дати</option>
                        {Object.entries(periodPresets).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className={field}>
                        Початок періоду
                        <input
                          className={control}
                          type="date"
                          required
                          value={start}
                          onChange={(e) => {
                            setStart(e.target.value)
                            setPreset('')
                            setPreview(null)
                          }}
                        />
                      </label>
                      <label className={field}>
                        Кінець періоду включно
                        <input
                          className={control}
                          type="date"
                          required
                          min={start}
                          value={end}
                          onChange={(e) => {
                            setEnd(e.target.value)
                            setPreset('')
                            setPreview(null)
                          }}
                        />
                      </label>
                    </div>
                    <label className={field}>
                      Дата документа
                      <input
                        className={control}
                        type="date"
                        required
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                      />
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Дата документа не змінює період відбору нарядів.
                    </p>
                    <AdjustmentFields
                      rows={adjustments}
                      onChange={(rows) => {
                        setAdjustments(rows)
                        setPreview(null)
                      }}
                    />
                    <Condition />
                    <button className={primary}>
                      <Calculator className="size-4" />
                      {pending ? 'Розрахунок…' : 'Заповнити за правилами'}
                    </button>
                  </fieldset>
                </form>
                <aside className={panel + ' h-fit space-y-4'}>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">
                    Умови працівника
                  </p>
                  <h2 className="text-xl font-semibold">{person?.name}</h2>
                  {rulesAt(person?.rules ?? [], end).map((r) => (
                    <div key={r.id} className="flex justify-between gap-4 border-t pt-4">
                      <div>
                        {r.name}
                        <p className="text-xs text-muted-foreground">Діє з {day(r.effective)}</p>
                      </div>
                      <b>{Number(r.rate)}%</b>
                    </div>
                  ))}
                  <button onClick={() => navigate('rules')} className="text-sm underline">
                    Переглянути налаштування
                  </button>
                  <p className="text-sm text-muted-foreground">
                    Для кожного наряду застосовуються правила, чинні на дату його закриття.
                  </p>
                  {person?.legacySalary && (
                    <p className="text-sm text-amber-700">
                      У старих налаштуваннях є оклад. Новий документ використовує лише відсоткові
                      правила.
                    </p>
                  )}
                </aside>
              </div>
            </>
          )}
          {view === 'document' && (
            <>
              {!details ? (
                <p>Документ не знайдено. Відкрийте його в журналі або створіть нове нарахування.</p>
              ) : (
                <>
                  <button
                    className="flex items-center gap-1 text-sm"
                    onClick={() => navigate('journal')}
                  >
                    <ChevronLeft className="size-4" />
                    Документи нарахування
                  </button>
                  <DocumentHeader
                    title={
                      selected
                        ? `Нарахування № ${shortNumber(selected.id)}`
                        : 'Нове нарахування зарплати'
                    }
                    description={`від ${day(date)}`}
                    status={
                      <DocumentStatus tone={posted ? 'success' : 'neutral'}>
                        {posted ? 'Проведено' : 'Чернетка'}
                      </DocumentStatus>
                    }
                    actions={
                      !posted &&
                      data.canManage && (
                        <button disabled={pending} className={button} onClick={recalculate}>
                          <RefreshCw className="size-4" />
                          Перерахувати
                        </button>
                      )
                    }
                  />
                  <div className={panel + ' flex flex-wrap items-center justify-between gap-6'}>
                    <div>
                      <p className="text-xs text-muted-foreground">Працівник</p>
                      <h2 className="text-lg font-semibold">{person?.name}</h2>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Період нарахування</p>
                      <b>
                        {day(start)} — {day(end)}
                      </b>
                    </div>
                    {!posted && data.canManage && (
                      <button className="text-sm underline" onClick={() => navigate('create')}>
                        Змінити параметри
                      </button>
                    )}
                  </div>
                  {!posted && data.canManage && (
                    <button className="text-sm underline" onClick={() => navigate('create')}>
                      Змінити премії та утримання
                    </button>
                  )}
                  <Condition start={start} end={end} />
                  {v2 ? (
                    <CommissionLines details={v2} zone={data.zone} />
                  ) : (
                    <>
                      <p className="rounded-lg border p-4 text-sm">
                        Документ попередньої версії.{' '}
                        {posted
                          ? 'Збережені суми не змінено.'
                          : 'Перед проведенням перерахуйте його за актуальними правилами.'}
                      </p>
                      <Lines details={details as unknown as SlipDetails} />
                    </>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-5">
                    <Link
                      href={`/employee-settlements?employee=${employee}`}
                      className="text-sm underline"
                    >
                      Взаєморозрахунки та виплати
                    </Link>
                    {posted && data.canManage && selected && (
                      <SalaryPayment key={selected.id} slipId={selected.id} />
                    )}
                    {!posted && data.canManage && (
                      <div className="flex flex-wrap gap-3">
                        <button
                          className={button}
                          disabled={
                            pending || !preview || !(v2?.lines.length || v2?.adjustments?.length)
                          }
                          onClick={() => save(false)}
                        >
                          Зберегти чернетку
                        </button>
                        <button
                          className={primary}
                          disabled={pending || !(v2?.lines.length || v2?.adjustments?.length)}
                          onClick={() => save(true)}
                        >
                          <Check className="size-4" />
                          Провести нарахування
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
          {view === 'rules' && (
            <>
              <DocumentHeader
                title="Правила працівників"
                description="Індивідуальні відсотки та бази нарахування. Роль працівника не обмежує вибір."
              />
              <label className={field + ' max-w-sm'}>
                Працівник
                <select
                  aria-label="Працівник"
                  className={control}
                  value={employee}
                  onChange={(e) => setEmployee(e.target.value)}
                >
                  {selectablePeople.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.crmRole ? ` · ${p.crmRole}` : ''}
                      {!p.active ? ' · архів' : ''}
                    </option>
                  ))}
                </select>
              </label>
              {person && (
                <IndividualRules
                  key={person.id}
                  person={person}
                  canManage={data.canManage}
                  today={today}
                  onChanged={() => router.refresh()}
                />
              )}
              <Condition />
            </>
          )}
        </>
      )}
    </main>
  )
}
