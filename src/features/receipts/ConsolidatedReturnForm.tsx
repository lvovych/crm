'use client'
import { useOperationText } from '@/i18n/use-operation-text'
import { ReturnReasonSelect } from './ReturnReasonSelect'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { createSupplierReturn, supplierReturnOptions } from './return-actions'
import { dayLabel, moneyLabel, unitPriceLabel } from '@/features/finance/presentation'
import { receiptTotal } from './money'
import { returnLineAmount } from './return-money'
type Data = NonNullable<Awaited<ReturnType<typeof supplierReturnOptions>>['data']>
export function ConsolidatedReturnForm({
  data,
  initial,
}: {
  data: Data
  initial?: {
    id: string
    version: number
    supplierDocumentNumber?: string | null
    reason: string
    quantities: Record<string, string>
  }
}) {
  const ot = useOperationText()

  const router = useRouter(),
    pending = useRef(false),
    request = useRef<string | undefined>(undefined)
  const [search, setSearch] = useState(''),
    [quantities, setQuantities] = useState<Record<string, string>>(initial?.quantities ?? {}),
    [supplierDocumentNumber, setSupplierDocumentNumber] = useState(
      initial?.supplierDocumentNumber ?? ''
    ),
    [reason, setReason] = useState(initial?.reason ?? ''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const [pageData, setPageData] = useState(data)
  const [selectedRows, setSelectedRows] = useState<Record<string, Data['lines'][number]>>(() =>
    Object.fromEntries(
      [...data.lines, ...data.selectedLines]
        .filter((line) => Object.hasOwn(initial?.quantities ?? {}, line.id))
        .map((line) => [line.id, line])
    )
  )
  const [loading, setLoading] = useState(false)
  const [searchError, setSearchError] = useState('')
  const searchRequest = useRef(0)
  useEffect(
    () => () => {
      searchRequest.current++
    },
    []
  )
  async function load(page: number, q: string) {
    const sequence = ++searchRequest.current
    setLoading(true)
    setSearchError('')
    try {
      const result = await supplierReturnOptions(data.supplierId, [], { page, q })
      if (sequence !== searchRequest.current) return
      if (!result.success || !result.data)
        throw new Error(result.error || ot('Не вдалося завантажити позиції.'))
      setPageData(result.data)
      setSelectedRows((current) => {
        const updated = { ...current }
        for (const line of result.data!.lines) if (updated[line.id]) updated[line.id] = line
        return updated
      })
    } catch {
      if (sequence === searchRequest.current)
        setSearchError(ot('Не вдалося завантажити позиції. Спробуйте ще раз.'))
    } finally {
      if (sequence === searchRequest.current) setLoading(false)
    }
  }
  const selected = Object.values(selectedRows).filter((line) => Object.hasOwn(quantities, line.id))
  const visible = pageData.lines
  const valid =
    selected.length > 0 &&
    selected.length === Object.keys(quantities).length &&
    selected.length <= 200 &&
    selected.every(
      (l) =>
        /^\d{1,9}(\.\d{1,3})?$/.test(quantities[l.id]) &&
        Number(quantities[l.id]) > 0 &&
        Number(quantities[l.id]) <= Number(l.available)
    )
  const total = receiptTotal(
    selected.map((l) => {
      try {
        return { amount: returnLineAmount(l, quantities[l.id]) }
      } catch {
        return { amount: '0.00' }
      }
    })
  )
  function update(id: string, value?: string) {
    request.current = undefined
    setSelectedRows((current) => {
      const next = { ...current }
      if (value === undefined) delete next[id]
      else {
        const line = visible.find((row) => row.id === id)
        if (line) next[id] = line
      }
      return next
    })
    setQuantities((q) => {
      const next = { ...q }
      if (value === undefined) delete next[id]
      else next[id] = value
      return next
    })
  }
  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault()
        if (pending.current || loading || !valid) return
        pending.current = true
        setBusy(true)
        setError('')
        request.current ??= crypto.randomUUID()
        try {
          const r = await createSupplierReturn({
            id: initial?.id ?? request.current,
            version: initial?.version,
            supplierId: data.supplierId,
            reason,
            supplierDocumentNumber,
            lines: selected.map((l) => ({ id: l.id, quantity: quantities[l.id] })),
          })
          if (!r.success || !r.data) {
            setError(r.error || ot('Не вдалося зберегти чернетку.'))
            return
          }
          router.push('/supplier-returns/' + r.data)
          router.refresh()
        } catch {
          setError(ot('Не вдалося отримати відповідь. Повторіть збереження з тими самими даними.'))
        } finally {
          pending.current = false
          setBusy(false)
        }
      }}
    >
      <section className="ops-panel space-y-4">
        <div>
          <h2 className="text-lg font-semibold">{ot('1. Оберіть товари або послуги')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {ot(
              'Доступні залишки з усіх проведених надходжень цього постачальника. Якщо одна запчастина є в кількох накладних, оберіть потрібне надходження та його ціну.'
            )}
          </p>
        </div>
        <label className="grid gap-2 text-sm">
          {ot('Знайти позицію')}
          <input
            value={search}
            maxLength={120}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void load(1, search)
              }
            }}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={ot('Артикул, бренд, назва або номер накладної')}
            className="h-11 rounded-md border bg-background px-3"
          />
        </label>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => void load(1, search)}
        >
          {loading ? ot('Пошук…') : ot('Знайти')}
        </Button>
        {searchError && (
          <p role="alert" className="text-destructive">
            {searchError}
          </p>
        )}
        <div className="ops-table-scroll" aria-busy={loading}>
          <table>
            <thead>
              <tr>
                <th>{ot('Вибрати')}</th>
                <th>{ot('Позиція / бренд')}</th>
                <th>{ot('Артикул')}</th>
                <th>{ot('Надходження')}</th>
                <th>{ot('Ціна')}</th>
                <th>{ot('Доступно')}</th>
                <th>{ot('Повернути')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((l) => (
                <tr key={l.id}>
                  <td>
                    <input
                      type="checkbox"
                      className="size-4"
                      aria-label={ot('Обрати ') + l.name + ' · ' + l.receiptNumber}
                      checked={Object.hasOwn(quantities, l.id)}
                      disabled={busy || loading || Number(l.available) <= 0}
                      onChange={(e) =>
                        update(
                          l.id,
                          e.target.checked ? String(Math.min(1, Number(l.available))) : undefined
                        )
                      }
                    />
                  </td>
                  <td>
                    <span className="font-medium">{l.name}</span>
                    <p className="text-sm text-muted-foreground">
                      {l.brand || (l.kind === 'service' ? ot('Послуга') : ot('Бренд не вказано'))}
                    </p>
                  </td>
                  <td className="font-mono">{l.article || '—'}</td>
                  <td>
                    <Link href={'/receipts/' + l.receiptId} className="underline">
                      {l.receiptNumber}
                    </Link>
                    <p className="text-xs text-muted-foreground">{dayLabel(l.receiptDate)}</p>
                  </td>
                  <td className="whitespace-nowrap">{unitPriceLabel(l.unitPrice)}</td>
                  <td>
                    {l.available} {l.unit}
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0.001"
                      step="0.001"
                      max={l.available}
                      aria-label={ot('Кількість ') + l.name + ' · ' + l.receiptNumber}
                      value={quantities[l.id] ?? ''}
                      disabled={busy || !Object.hasOwn(quantities, l.id)}
                      required={Object.hasOwn(quantities, l.id)}
                      onChange={(e) => update(l.id, e.target.value)}
                      className="h-11 w-24 rounded border bg-background px-3"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!visible.length && (
          <p role="status" className="p-4 text-sm text-muted-foreground">
            {pageData.q
              ? ot('Позицій за цим пошуком немає.')
              : ot('Немає доступних залишків для повернення.')}
          </p>
        )}
        <nav
          aria-label={ot('Сторінки доступних позицій')}
          className="flex flex-wrap items-center gap-3"
        >
          <Button
            type="button"
            variant="outline"
            disabled={busy || loading || pageData.page <= 1}
            onClick={() => void load(pageData.page - 1, pageData.q)}
          >
            {ot('Назад')}
          </Button>
          <span aria-live="polite">
            {ot("Сторінка ")}
            {pageData.page}
          </span>
          <Button
            type="button"
            variant="outline"
            disabled={busy || loading || !pageData.hasMore}
            onClick={() => void load(pageData.page + 1, pageData.q)}
          >
            {ot('Далі')}
          </Button>
        </nav>
      </section>
      <section className="ops-panel space-y-4">
        <h2 className="text-lg font-semibold">
          {ot("2. Перевірте повернення · ")}
          {selected.length} {ot(" поз.")}
        </h2>
        {selected.length > 0 && (
          <ul className="divide-y">
            {selected.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="font-medium">
                    {l.brand} {l.article} · {l.name}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {ot("Накладна ")}
                    {l.receiptNumber} · {quantities[l.id]} {l.unit}
                  </p>
                </div>
                <Button type="button" variant="ghost" disabled={busy} onClick={() => update(l.id)}>
                  {ot('Прибрати')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xl font-semibold">
          {ot("Сума: ")}
          {moneyLabel(total, ot('грн'))}
        </p>
        <p className="text-sm text-muted-foreground">
          {ot("Документ зменшить складський залишок і загальний борг перед ")}
          {data.supplier}
          {ot('. Оплати накладних не зміняться.')}
        </p>
        <label className="grid gap-2 text-sm">
          {ot('Номер документа постачальника')}
          <input
            type="text"
            maxLength={120}
            disabled={busy}
            value={supplierDocumentNumber}
            onChange={(e) => {
              request.current = undefined
              setSupplierDocumentNumber(e.target.value)
            }}
            placeholder={ot('Необов’язково')}
            className="h-11 w-full rounded-md border bg-background px-3"
          />
        </label>
        <ReturnReasonSelect
          value={reason}
          disabled={busy}
          onChange={(value) => {
            request.current = undefined
            setReason(value)
          }}
        />
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <Button disabled={busy || loading || !valid}>
          {busy ? ot('Збереження…') : ot('Зберегти чернетку')}
        </Button>
      </section>
    </form>
  )
}
