'use client'
import Link from 'next/link'
import { useState } from 'react'
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <section className="rounded-xl border-2 border-border p-5 space-y-4">
      <h2 className="text-xl font-semibold">Повернення постачальнику</h2>
      <p>{data.supplier}</p>
      {canCreate && data.enabled && (
        <details>
          <summary className="cursor-pointer py-3 font-semibold">
            Створити повернення з накладної
          </summary>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault()
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
                setBusy(false)
              }
            }}
          >
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setRequestId(undefined)
                setQuantities(Object.fromEntries(data.lines.map((l) => [l.id, l.available])))
              }}
            >
              Повернути все доступне з накладної
            </Button>
            <div className="overflow-x-auto">
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
                      <td>{l.unitPrice} грн</td>
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
            <label className="block">
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
        <article key={d.id} id={d.id} className="rounded border p-4 space-y-3">
          <h3 className="font-semibold">
            <Link className="underline" href={'/receipts/' + receiptId + '/returns/' + d.id}>
              {d.number}
            </Link>{' '}
            · {d.date} · Проведено
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
                  <td>{l.amount} грн</td>
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
