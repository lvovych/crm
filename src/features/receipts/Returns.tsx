'use client'
import { moneyLabel, dayLabel, unitPriceLabel } from '@/features/finance/presentation'
import { DocumentStatus } from '@/components/operations/document-ui'
import Link from 'next/link'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { createSupplierReturn, type supplierReturnData } from './return-actions'

type Data = NonNullable<Awaited<ReturnType<typeof supplierReturnData>>['data']>
export function Returns({
  receiptId,
  data,
  canCreate,
}: {
  receiptId: string
  data: Data
  canCreate: boolean
}) {
  const router = useRouter()
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [requestId, setRequestId] = useState<string>()
  const submitting = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <section className="ops-panel space-y-5">
      <h2 className="text-xl font-semibold">Повернення постачальнику</h2>
      <p className="text-sm text-muted-foreground">
        {data.supplier} · Повернення зменшує борг постачальнику та залишок товарів на складі.
      </p>
      {!data.lines.some((l) => Number(l.available) > 0) && data.enabled && (
        <p className="rounded-lg bg-muted p-4 text-sm" role="status">
          Немає доступних позицій для повернення: товари вже передані в наряди або повернуті
          постачальнику.
        </p>
      )}
      {canCreate && data.enabled && (
        <details>
          <summary className="cursor-pointer py-3 font-semibold">
            Створити повернення з накладної
          </summary>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault()
              if (submitting.current) return
              submitting.current = true
              setBusy(true)
              setError('')
              const id = requestId ?? crypto.randomUUID()
              setRequestId(id)
              try {
                const result = await createSupplierReturn({
                  id,
                  receiptId,
                  reason,
                  lines: data.lines
                    .filter((l) => Number(quantities[l.id]) > 0)
                    .map((l) => ({ id: l.id, quantity: quantities[l.id] })),
                })
                if (!result.success) {
                  setError(result.error ?? 'Не вдалося провести повернення.')
                  return
                }
                setQuantities({})
                setReason('')
                setRequestId(undefined)
                router.refresh()
              } catch {
                setError(
                  'Не вдалося отримати відповідь. Повторіть проведення з тими самими даними.'
                )
              } finally {
                submitting.current = false
                setBusy(false)
              }
            }}
          >
            <Button
              type="button"
              variant="outline"
              disabled={busy || !data.lines.some((l) => Number(l.available) > 0)}
              onClick={() => {
                setRequestId(undefined)
                setQuantities(Object.fromEntries(data.lines.map((l) => [l.id, l.available])))
              }}
            >
              Повернути все доступне з накладної
            </Button>
            <div className="ops-table-scroll">
              <table className="w-full text-left">
                <thead className="bg-muted">
                  <tr>
                    <th className="p-3">Позиція</th>
                    <th>Ціна закупівлі</th>
                    <th>Доступно</th>
                    <th>Повернути</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((l) => (
                    <tr key={l.id} className="border-b">
                      <td className="p-3">{l.name}</td>
                      <td className="text-right">{unitPriceLabel(l.unitPrice)}</td>
                      <td>
                        {l.available} {l.unit}
                      </td>
                      <td>
                        <input
                          aria-label={'Повернути ' + l.name}
                          type="number"
                          min="0"
                          max={l.available}
                          step=".001"
                          className="h-11 w-28 rounded border bg-background px-3"
                          disabled={busy || Number(l.available) <= 0}
                          value={quantities[l.id] ?? ''}
                          onChange={(e) => {
                            setRequestId(undefined)
                            setQuantities({ ...quantities, [l.id]: e.target.value })
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <label className="grid gap-2 text-sm font-medium">
              Причина повернення
              <input
                required
                maxLength={1000}
                value={reason}
                disabled={busy}
                onChange={(e) => {
                  setRequestId(undefined)
                  setReason(e.target.value)
                }}
                className="block h-11 w-full rounded border bg-background px-3"
              />
            </label>
            <Button disabled={busy || !data.lines.some((l) => Number(quantities[l.id]) > 0)}>
              {busy ? 'Проведення…' : 'Провести повернення'}
            </Button>
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
          </form>
        </details>
      )}
      {data.documents.map((d) => (
        <article key={d.id} id={d.id} className="rounded-xl border bg-muted/20 p-4 space-y-3">
          <h3 className="flex flex-wrap items-center gap-2 font-semibold">
            <Link className="underline" href={'/receipts/' + receiptId + '/returns/' + d.id}>
              {d.number}
            </Link>{' '}
            · {dayLabel(d.date)} <DocumentStatus tone="success">Проведено</DocumentStatus>
          </h3>
          <p>{d.reason}</p>
          <table className="w-full text-left">
            <thead className="bg-muted">
              <tr>
                <th className="p-2">Позиція</th>
                <th>Кількість</th>
                <th>Сума</th>
              </tr>
            </thead>
            <tbody>
              {d.lines.map((l, i) => (
                <tr key={i} className="border-b">
                  <td className="p-2">{l.name}</td>
                  <td>
                    {l.quantity} {l.unit}
                  </td>
                  <td className="text-right">{moneyLabel(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-lg font-semibold">
            Разом {d.lines.reduce((n, l) => n + Math.round(Number(l.amount) * 100), 0) / 100} грн
          </p>
        </article>
      ))}
      {!data.enabled && !data.documents.length && (
        <p>Повернення доступне після проведення та звірки накладної у взаєморозрахунках.</p>
      )}
    </section>
  )
}
