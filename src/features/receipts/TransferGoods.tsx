'use client'
import { useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { receiptTransferOptions, transferFromReceipt } from './transfer-actions'
type Options = NonNullable<Awaited<ReturnType<typeof receiptTransferOptions>>['data']>
export function TransferGoods({ receiptId, data }: { receiptId: string; data: Options }) {
  const router = useRouter()
  const [selected, setSelected] = useState<string[]>([])
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [order, setOrder] = useState('')
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('')
  const [href, setHref] = useState('')
  const [pending, start] = useTransition()
  const request = useRef({ body: '', id: '' })
  const eligible = data.lines.filter((l) => Number(l.available) > 0)
  function send(ids: string[]) {
    if (!order) {
      setMessage('Оберіть наряд-замовлення.')
      return
    }
    const body = {
      receiptId,
      serviceRecordId: order,
      lines: ids.map((id) => {
        const line = data.lines.find((l) => l.id === id)!
        return {
          id,
          quantity: quantities[id] ?? line.available,
          unitPrice: prices[id] ?? line.unitPrice,
        }
      }),
    }
    const serialized = JSON.stringify(body)
    if (request.current.body !== serialized)
      request.current = { body: serialized, id: crypto.randomUUID() }
    start(async () => {
      setMessage('')
      setHref('')
      try {
        const result = await transferFromReceipt({ ...body, requestId: request.current.id })
        if (!result.data) {
          setMessage(result.error || 'Не вдалося передати товари.')
          return
        }
        setMessage(`Додано позицій у наряд: ${result.data.count}. Складський залишок оновлено.`)
        setHref(`/vehicles/${result.data.vehicleId}/service/${result.data.serviceRecordId}`)
        request.current = { body: '', id: '' }
        setSelected([])
        setQuantities({})
        router.refresh()
      } catch {
        setMessage(
          'Не отримано відповіді. Оновіть сторінку та перевірте історію передавання перед повторною дією.'
        )
      }
    })
  }
  return (
    <section className="rounded-xl border-2 border-primary/30 bg-primary/5 p-5 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Передати товари в наряд</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Оберіть наряд і товари. Передавання додає позиції в наряд та списує їх зі складу. Для
          різних нарядів повторіть дію з іншими товарами.
        </p>
      </div>
      <fieldset disabled={pending} className="min-w-0 space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 block">
            Пошук наряду
            <Input
              placeholder="Номер наряду або автомобіля"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label className="space-y-1 block">
            Наряд-замовлення
            <select
              className="w-full rounded-md border bg-background p-2"
              value={order}
              onChange={(e) => setOrder(e.target.value)}
            >
              <option value="">Оберіть відкритий наряд</option>
              {data.orders
                .filter(
                  (o) => o.id === order || o.label.toLowerCase().includes(query.toLowerCase())
                )
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
            </select>
          </label>
        </div>
        {!data.orders.length && (
          <p>Немає відкритих нарядів. Створіть наряд або відкрийте потрібний для роботи.</p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={!eligible.length}
            onClick={() =>
              setSelected(selected.length === eligible.length ? [] : eligible.map((l) => l.id))
            }
          >
            {selected.length === eligible.length && eligible.length
              ? 'Зняти вибір'
              : 'Вибрати всі товари'}
          </Button>
          <span>Вибрано: {selected.length}</span>
          <Button
            type="button"
            disabled={!selected.length || !order}
            onClick={() => send(selected)}
          >
            Додати вибрані в наряд
          </Button>
        </div>
        <div className="overflow-auto rounded-lg border bg-background">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted">
              <tr>
                {[
                  'Вибір',
                  'Товар / артикул',
                  'Можна передати',
                  'Кількість',
                  'Ціна продажу, грн',
                  'Дія',
                ].map((h) => (
                  <th className="p-3" key={h}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="p-3">
                    <input
                      aria-label={`Вибрати ${l.name}`}
                      type="checkbox"
                      disabled={Number(l.available) === 0}
                      checked={selected.includes(l.id)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, l.id]
                            : selected.filter((id) => id !== l.id)
                        )
                      }
                    />
                  </td>
                  <td className="p-3 min-w-48">
                    <strong>{l.name}</strong>
                    <div>{l.article}</div>
                    {l.transfers.map((t) => (
                      <p className="mt-1 text-xs text-muted-foreground" key={t.id}>
                        Передано {t.quantity} {l.unit} →{' '}
                        <Link className="underline" href={t.href}>
                          {t.label}
                        </Link>
                      </p>
                    ))}
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    {l.available} {l.unit}
                    <p className="text-xs text-muted-foreground">На складі: {l.stock}</p>
                  </td>
                  <td className="p-3">
                    <Input
                      aria-label={`Кількість ${l.name}`}
                      className="w-28"
                      type="number"
                      min="0.001"
                      step="0.001"
                      max={l.available}
                      disabled={Number(l.available) === 0}
                      value={quantities[l.id] ?? l.available}
                      onChange={(e) => setQuantities({ ...quantities, [l.id]: e.target.value })}
                    />
                  </td>
                  <td className="p-3">
                    <Input
                      aria-label={`Ціна продажу ${l.name}`}
                      className="w-28"
                      type="number"
                      min="0"
                      step="0.0001"
                      value={prices[l.id] ?? l.unitPrice}
                      onChange={(e) => setPrices({ ...prices, [l.id]: e.target.value })}
                    />
                  </td>
                  <td className="p-3">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!order || Number(l.available) === 0}
                      onClick={() => send([l.id])}
                    >
                      Додати в наряд
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </fieldset>
      {pending && <p role="status">Передаємо товари…</p>}
      {message && (
        <p role="status">
          {message}{' '}
          {href && (
            <Link className="underline" href={href}>
              Відкрити наряд →
            </Link>
          )}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Історія фіксує первинне передавання. Подальші зміни кількості в наряді не змінюють цю
        історію.
      </p>
    </section>
  )
}
