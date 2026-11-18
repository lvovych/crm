'use client'
import { ReturnReasonSelect } from './ReturnReasonSelect'
import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { createSupplierReturn, type supplierReturnOptions } from './return-actions'
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
  const selected = data.lines.filter((l) => Object.hasOwn(quantities, l.id))
  const visible = data.lines.filter((l) =>
    [l.name, l.brand, l.article, l.receiptNumber]
      .join(' ')
      .toLowerCase()
      .includes(search.toLowerCase().trim())
  )
  const valid =
    selected.length > 0 &&
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
        if (pending.current || !valid) return
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
            setError(r.error || 'Не вдалося зберегти чернетку.')
            return
          }
          router.push('/supplier-returns/' + r.data)
          router.refresh()
        } catch {
          setError('Не вдалося отримати відповідь. Повторіть збереження з тими самими даними.')
        } finally {
          pending.current = false
          setBusy(false)
        }
      }}
    >
      <section className="ops-panel space-y-4">
        <div>
          <h2 className="text-lg font-semibold">1. Оберіть товари або послуги</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Доступні залишки з усіх проведених надходжень цього постачальника. Якщо одна запчастина
            є в кількох накладних, оберіть потрібне надходження та його ціну.
          </p>
        </div>
        <label className="grid gap-2 text-sm">
          Знайти позицію
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Артикул, бренд, назва або номер накладної"
            className="h-11 rounded-md border bg-background px-3"
          />
        </label>
        <div className="ops-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Вибрати</th>
                <th>Позиція / бренд</th>
                <th>Артикул</th>
                <th>Надходження</th>
                <th>Ціна</th>
                <th>Доступно</th>
                <th>Повернути</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((l) => (
                <tr key={l.id}>
                  <td>
                    <input
                      type="checkbox"
                      className="size-4"
                      aria-label={'Обрати ' + l.name + ' · ' + l.receiptNumber}
                      checked={Object.hasOwn(quantities, l.id)}
                      disabled={busy}
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
                      {l.brand || (l.kind === 'service' ? 'Послуга' : 'Бренд не вказано')}
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
                      aria-label={'Кількість ' + l.name + ' · ' + l.receiptNumber}
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
            {data.lines.length
              ? 'Позицій за цим пошуком немає.'
              : 'Немає доступних залишків для повернення.'}
          </p>
        )}
      </section>
      <section className="ops-panel space-y-4">
        <h2 className="text-lg font-semibold">2. Перевірте повернення · {selected.length} поз.</h2>
        {selected.length > 0 && (
          <ul className="divide-y">
            {selected.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="font-medium">
                    {l.brand} {l.article} · {l.name}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Накладна {l.receiptNumber} · {quantities[l.id]} {l.unit}
                  </p>
                </div>
                <Button type="button" variant="ghost" disabled={busy} onClick={() => update(l.id)}>
                  Прибрати
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xl font-semibold">Сума: {moneyLabel(total)}</p>
        <p className="text-sm text-muted-foreground">
          Документ зменшить складський залишок і загальний борг перед {data.supplier}. Оплати
          накладних не зміняться.
        </p>
        <label className="grid gap-2 text-sm">
          Номер документа постачальника
          <input
            type="text"
            maxLength={120}
            value={supplierDocumentNumber}
            onChange={(e) => {
              request.current = undefined
              setSupplierDocumentNumber(e.target.value)
            }}
            placeholder="Необов’язково"
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
        <Button disabled={busy || !valid}>{busy ? 'Збереження…' : 'Зберегти чернетку'}</Button>
      </section>
    </form>
  )
}
