'use client'
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { saveDraft, type receiptOptions } from './actions'
import { createInventoryPart } from '@/features/inventory/Actions/inventoryActions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Options = NonNullable<Awaited<ReturnType<typeof receiptOptions>>['data']>
type Line = {
  kind: 'part' | 'service'
  name: string
  partId: string | null
  quantity: string
  unitPrice: string
  unit: string
}
type Draft = {
  id: string
  version: number
  supplierId: string
  number: string
  documentDate: string
  receivedDate: string
  lines: Line[]
}
const blank = (): Line => ({
  kind: 'part',
  name: '',
  partId: null,
  quantity: '1',
  unitPrice: '0',
  unit: 'шт',
})
const selectClass = 'w-full rounded-md border bg-background p-2'
const money = (cents: bigint) =>
  (cents / BigInt(100)).toLocaleString('uk-UA') +
  ',' +
  (cents % BigInt(100)).toString().padStart(2, '0')
// Scale the input strings before multiplication to match PostgreSQL decimal rounding.
function cents(line: Line) {
  const scaled = (s: string, places: number) => {
    const [i, f = ''] = s.split('.')
    return BigInt((i || '0') + f.padEnd(places, '0'))
  }
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(line.quantity) || !/^\d{1,9}(\.\d{1,4})?$/.test(line.unitPrice))
    return BigInt(0)
  return (scaled(line.quantity, 3) * scaled(line.unitPrice, 4) + BigInt(50000)) / BigInt(100000)
}
export default function ReceiptForm({ options, initial }: { options: Options; initial: Draft }) {
  const router = useRouter()
  const [doc, setDoc] = useState(initial)
  const [parts, setParts] = useState(options.parts)
  const [queries, setQueries] = useState<Record<number, string>>({})
  const [error, setError] = useState(''),
    [duplicate, setDuplicate] = useState('')
  const [busy, start] = useTransition()
  function patch(index: number, changes: Partial<Line>) {
    setDoc((d) => ({
      ...d,
      lines: d.lines.map((l, i) => (i === index ? { ...l, ...changes } : l)),
    }))
  }
  function field(key: 'number' | 'supplierId' | 'documentDate' | 'receivedDate', value: string) {
    setDoc((d) => ({ ...d, [key]: value }))
  }
  function save() {
    start(async () => {
      setError('')
      setDuplicate('')
      const r = await saveDraft(doc)
      if (!r.data) {
        setError(r.error || 'Помилка збереження')
        return
      }
      if (r.data.duplicate) {
        setDuplicate(r.data.id)
        return
      }
      router.push('/receipts/' + r.data.id)
      router.refresh()
    })
  }
  function newPart(index: number, l: Line) {
    start(async () => {
      if (!l.name.trim()) {
        setError('Введіть назву нової запчастини.')
        return
      }
      const r = await createInventoryPart({ name: l.name, unit: l.unit, quantity: 0 })
      if (!r.data) {
        setError(r.error || 'Помилка створення')
        return
      }
      setParts((p) => [...p, { ...r.data!, brand: { name: '---' } }])
      setQueries((q) => ({ ...q, [index]: '' }))
      patch(index, { partId: r.data.id })
      setError('')
    })
  }
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <fieldset disabled={busy} className="space-y-5">
        <div className="grid gap-3 md:grid-cols-4">
          <label>
            Постачальник
            <select
              required
              className={selectClass}
              value={doc.supplierId}
              onChange={(e) => field('supplierId', e.target.value)}
            >
              <option value="">Оберіть постачальника</option>
              {options.suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Номер накладної
            <Input
              required
              maxLength={100}
              value={doc.number}
              onChange={(e) => field('number', e.target.value)}
            />
          </label>
          <label>
            Дата документа
            <Input
              required
              type="date"
              value={doc.documentDate}
              onChange={(e) => field('documentDate', e.target.value)}
            />
          </label>
          <label>
            Дата приймання
            <Input
              required
              type="date"
              value={doc.receivedDate}
              onChange={(e) => field('receivedDate', e.target.value)}
            />
          </label>
        </div>
        {doc.lines.map((l, i) => (
          <section key={i} className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <strong>Позиція {i + 1}</strong>
              <Button
                type="button"
                variant="ghost"
                disabled={doc.lines.length === 1}
                onClick={() => {
                  setDoc({ ...doc, lines: doc.lines.filter((_, j) => j !== i) })
                  setQueries({})
                }}
              >
                Видалити рядок
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <label>
                Тип
                <select
                  className={selectClass}
                  value={l.kind}
                  onChange={(e) =>
                    patch(i, {
                      kind: e.target.value as Line['kind'],
                      partId: null,
                      unit: e.target.value === 'service' ? 'посл.' : 'шт',
                    })
                  }
                >
                  <option value="part">Запчастина</option>
                  <option value="service">Послуга</option>
                </select>
              </label>
              {l.kind === 'part' && (
                <>
                  <label>
                    Пошук за назвою, брендом, артикулом або штрихкодом
                    <Input
                      value={queries[i] || ''}
                      onChange={(e) => setQueries({ ...queries, [i]: e.target.value })}
                    />
                  </label>
                  <label>
                    Складська картка
                    <select
                      className={selectClass}
                      value={l.partId ?? ''}
                      onChange={(e) => {
                        const p = parts.find((p) => p.id === e.target.value)
                        patch(i, {
                          partId: p?.id ?? null,
                          name: p?.name ?? '',
                          unit: p?.unit || 'шт',
                        })
                      }}
                    >
                      <option value="">Зіставити перед проведенням</option>
                      {parts
                        .filter(
                          (p) =>
                            p.id === l.partId ||
                            [p.name, p.brand.name, p.partNumber, p.barcode]
                              .join(' ')
                              .toLowerCase()
                              .includes((queries[i] || '').toLowerCase())
                        )
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} · {p.brand.name} {p.partNumber} {p.barcode}
                          </option>
                        ))}
                    </select>
                  </label>
                </>
              )}
            </div>
            <div className="grid gap-3 md:grid-cols-5">
              <label>
                Назва з накладної
                <Input
                  required
                  value={l.name}
                  onChange={(e) => patch(i, { name: e.target.value })}
                />
              </label>
              <label>
                Одиниця
                <Input
                  required
                  readOnly={!!l.partId}
                  value={l.unit}
                  onChange={(e) => patch(i, { unit: e.target.value })}
                />
              </label>
              <label>
                Кількість
                <Input
                  required
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={l.quantity}
                  onChange={(e) => patch(i, { quantity: e.target.value })}
                />
              </label>
              <label>
                Ціна, грн
                <Input
                  required
                  type="number"
                  min="0"
                  step="0.0001"
                  value={l.unitPrice}
                  onChange={(e) => patch(i, { unitPrice: e.target.value })}
                />
              </label>
              <p>
                Сума, грн
                <br />
                {money(cents(l))}
              </p>
            </div>
            {l.kind === 'part' && !l.partId && (
              <Button type="button" variant="outline" onClick={() => newPart(i, l)}>
                Створити складську картку з нульовим залишком
              </Button>
            )}
          </section>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() => setDoc({ ...doc, lines: [...doc.lines, blank()] })}
        >
          Додати рядок
        </Button>
        <p className="text-xl font-semibold">
          Разом {money(doc.lines.reduce((s, l) => s + cents(l), BigInt(0)))} грн
        </p>
        <Button type="submit">Зберегти чернетку</Button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      {duplicate && (
        <Link className="underline" href={'/receipts/' + duplicate}>
          Така накладна вже є. Відкрити документ
        </Link>
      )}
    </form>
  )
}
