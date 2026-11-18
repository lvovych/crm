'use client'
import { useOperationText } from '@/i18n/use-operation-text'
import { ReturnReasonSelect } from './ReturnReasonSelect'
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
  const ot = useOperationText()

  const router = useRouter()
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [supplierDocumentNumber, setSupplierDocumentNumber] = useState('')
  const [reason, setReason] = useState('')
  const [requestId, setRequestId] = useState<string>()
  const submitting = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <section className="ops-panel space-y-5">
      <h2 className="text-xl font-semibold">{ot('Повернення постачальнику')}</h2>
      <p className="text-sm text-muted-foreground">
        {data.supplier}{' '}
        {ot(" · Повернення зменшує борг постачальнику та залишок товарів на складі.")}
      </p>
      {!data.lines.some((l) => Number(l.available) > 0) && data.enabled && (
        <p className="rounded-lg bg-muted p-4 text-sm" role="status">
          {ot(
            'Немає доступних позицій для повернення: товари вже передані в наряди або повернуті постачальнику.'
          )}
        </p>
      )}
      {canCreate && (
        <Button asChild variant="outline">
          <Link href={'/supplier-returns/new?supplier=' + data.supplierId}>
            {ot('Повернення з кількох накладних')}
          </Link>
        </Button>
      )}
      {canCreate && data.enabled && (
        <details>
          <summary className="cursor-pointer py-3 font-semibold">
            {ot('Створити повернення з накладної')}
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
                  supplierDocumentNumber,
                  lines: data.lines
                    .filter((l) => Number(quantities[l.id]) > 0)
                    .map((l) => ({ id: l.id, quantity: quantities[l.id] })),
                })
                if (!result.success) {
                  setError(result.error ?? ot('Не вдалося провести повернення.'))
                  return
                }
                setQuantities({})
                setReason('')
                setSupplierDocumentNumber('')
                setRequestId(undefined)
                router.push('/supplier-returns/' + result.data)
                router.refresh()
              } catch {
                setError(
                  ot('Не вдалося отримати відповідь. Повторіть проведення з тими самими даними.')
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
              {ot('Повернути все доступне з накладної')}
            </Button>
            <div className="ops-table-scroll">
              <table className="w-full text-left">
                <thead className="bg-muted">
                  <tr>
                    <th className="p-3">{ot('Позиція')}</th>
                    <th>{ot('Бренд')}</th>
                    <th>{ot('Артикул')}</th>
                    <th>{ot('Ціна закупівлі')}</th>
                    <th>{ot('Доступно')}</th>
                    <th>{ot("Повернути ")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((l) => (
                    <tr key={l.id} className="border-b">
                      <td className="p-3">{l.name}</td>
                      <td>{l.brand || '—'}</td>
                      <td className="font-mono">{l.article || '—'}</td>
                      <td className="text-right">{unitPriceLabel(l.unitPrice)}</td>
                      <td>
                        {l.available} {l.unit}
                      </td>
                      <td>
                        <input
                          aria-label={ot('Повернути ') + l.name}
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
            <label className="grid gap-2">
              {ot('Номер документа постачальника')}
              <input
                type="text"
                maxLength={120}
                value={supplierDocumentNumber}
                onChange={(e) => {
                  setRequestId(undefined)
                  setSupplierDocumentNumber(e.target.value)
                }}
                className="h-11 rounded-md border bg-background px-3"
                placeholder={ot('Необов’язково')}
              />
            </label>
            <ReturnReasonSelect
              value={reason}
              disabled={busy}
              onChange={(value) => {
                setRequestId(undefined)
                setReason(value)
              }}
            />
            <Button disabled={busy || !data.lines.some((l) => Number(quantities[l.id]) > 0)}>
              {busy ? ot('Збереження…') : ot('Зберегти чернетку')}
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
            <Link className="underline" href={'/supplier-returns/' + d.id}>
              {d.number}
            </Link>{' '}
            · {dayLabel(d.date)}{' '}
            <DocumentStatus>
              {d.status === 'posted' ? ot('Проведено') : ot('Чернетка')}
            </DocumentStatus>
          </h3>
          <p>{d.reason}</p>
          <table className="w-full text-left">
            <thead className="bg-muted">
              <tr>
                <th className="p-2">{ot('Позиція')}</th>
                <th>{ot('Бренд')}</th>
                <th>{ot('Артикул')}</th>
                <th>{ot('Надходження')}</th>
                <th>{ot('Кількість')}</th>
                <th>{ot('Сума')}</th>
              </tr>
            </thead>
            <tbody>
              {d.lines.map((l, i) => (
                <tr key={i} className="border-b">
                  <td className="p-2">{l.name}</td>
                  <td>{l.brand || '—'}</td>
                  <td className="font-mono">{l.article || '—'}</td>
                  <td>
                    <Link className="underline" href={'/receipts/' + l.receiptId}>
                      {l.receiptNumber}
                    </Link>
                  </td>
                  <td>
                    {l.quantity} {l.unit}
                  </td>
                  <td className="text-right">{moneyLabel(l.amount, ot('грн'))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-lg font-semibold">
            {ot("Разом ")}
            {d.lines.reduce((n, l) => n + Math.round(Number(l.amount) * 100), 0) / 100} {ot(" грн")}
          </p>
        </article>
      ))}
      {!data.enabled && !data.documents.length && (
        <p>{ot('Повернення доступне після проведення та звірки накладної у взаєморозрахунках.')}</p>
      )}
    </section>
  )
}
