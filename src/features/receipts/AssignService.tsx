'use client'
import { useOperationText } from '@/i18n/use-operation-text'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { linkServiceReceipt } from './subcontract-actions'

export function AssignService({
  lineId,
  orders,
}: {
  lineId: string
  orders: {
    id: string
    label: string
    open: boolean
    works: { id: string; description: string }[]
  }[]
}) {
  const ot = useOperationText()

  const [open, setOpen] = useState(false)
  const [order, setOrder] = useState('')
  const [labor, setLabor] = useState('')
  const [sale, setSale] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  if (!open)
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        {ot('Віднести на наряд')}
      </Button>
    )
  return (
    <div className="grid gap-2">
      <select
        aria-label={ot('Наряд')}
        value={order}
        onChange={(e) => {
          setOrder(e.target.value)
          const target = orders.find((o) => o.id === e.target.value)
          setLabor(target?.open ? '' : (target?.works[0]?.id ?? ''))
        }}
      >
        <option value="">{ot('Оберіть наряд')}</option>
        {orders.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <select aria-label={ot('Робота')} value={labor} onChange={(e) => setLabor(e.target.value)}>
        {orders.find((o) => o.id === order)?.open && (
          <option value="">{ot('Додати нову роботу')}</option>
        )}
        {orders
          .find((o) => o.id === order)
          ?.works.map((l) => (
            <option key={l.id} value={l.id}>
              {l.description}
            </option>
          ))}
      </select>
      {!labor && (
        <label>
          {ot('Ціна продажу')}{' '}
          <input
            type="number"
            min="0"
            step="0.01"
            value={sale}
            onChange={(e) => setSale(e.target.value)}
          />
        </label>
      )}
      <Button
        disabled={busy || !order || (!labor && !sale)}
        onClick={async () => {
          setBusy(true)
          try {
            const result = await linkServiceReceipt(order, lineId, labor || null, sale)
            if (result.success) router.refresh()
            else setError(result.error || ot('Помилка збереження.'))
          } finally {
            setBusy(false)
          }
        }}
      >
        {ot('Підтвердити')}
      </Button>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
