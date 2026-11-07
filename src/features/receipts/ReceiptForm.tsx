'use client'
import { lineCents } from './money'
import { matchArticle } from './articles'
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { saveDraft, type receiptOptions } from './actions'
import { createInventoryPart } from '@/features/inventory/Actions/inventoryActions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Options = NonNullable<Awaited<ReturnType<typeof receiptOptions>>['data']>
type Line = {
  article: string
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
  article: '',
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
export default function ReceiptForm({
  options,
  initial,
  canPost,
}: {
  options: Options
  initial: Draft
  canPost: boolean
}) {
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
    setDoc((d) => ({
      ...d,
      [key]: value,
      lines:
        key === 'supplierId'
          ? d.lines.map((l) => (l.kind === 'part' ? resolve(l, value) : l))
          : d.lines,
    }))
  }
  function resolve(l: Line, supplierId: string): Line {
    const matches = matchArticle(parts, supplierId, l.article)
    const part = matches.length === 1 ? matches[0] : null
    return { ...l, partId: part?.id ?? null, name: part?.name ?? '', unit: part?.unit || 'шт' }
  }
  function save(post: boolean) {
    start(async () => {
      setError('')
      setDuplicate('')
      const r = await saveDraft(doc, post)
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
      if (!doc.supplierId || !l.article.trim()) {
        setError('Оберіть постачальника та вкажіть артикул.')
        return
      }
      if (!l.name.trim()) {
        setError('Введіть назву нової запчастини.')
        return
      }
      const r = await createInventoryPart({
        name: l.name,
        partNumber: l.article,
        unit: l.unit,
        quantity: 0,
      })
      if (!r.data) {
        setError(r.error || 'Помилка створення')
        return
      }
      setParts((p) => [...p, { ...r.data!, supplierArticles: [], brand: { name: '---' } }])
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
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
        save(submitter?.value === 'post')
      }}
    >
      <fieldset disabled={busy} className="space-y-5">
        <section className="rounded-xl border-2 border-border bg-muted/30 p-5 space-y-4">
          <h2 className="text-lg font-semibold">1. Дані накладної</h2>
          <p className="text-sm text-muted-foreground">
            Оберіть постачальника та вкажіть номер і дати документа.
          </p>
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
        </section>
        <section className="rounded-xl border-2 border-border p-5 space-y-4">
          <h2 className="text-lg font-semibold">2. Товари та послуги</h2>
          <p className="text-sm text-muted-foreground">
            Введіть артикул із накладної. Система знайде товар за його артикулами, зокрема
            артикулами цього постачальника.
          </p>
          {doc.lines.map((l, i) => (
            <section key={i} className="space-y-3 rounded-lg border border-border bg-muted/25 p-4">
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
                        article: '',
                        name: '',
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
                      Артикул
                      <Input
                        required
                        maxLength={120}
                        value={l.article}
                        placeholder="Наприклад, FE 12345"
                        onChange={(e) =>
                          patch(i, resolve({ ...l, article: e.target.value }, doc.supplierId))
                        }
                      />
                    </label>
                    {l.partId ? (
                      <p aria-live="polite">
                        Товар знайдено на складі
                        <br />
                        <strong>{parts.find((p) => p.id === l.partId)?.name}</strong>
                      </p>
                    ) : (
                      doc.supplierId &&
                      l.article.trim() && (
                        <div className="space-y-2">
                          <p>
                            {matchArticle(parts, doc.supplierId, l.article).length > 1
                              ? 'Знайдено кілька товарів. Уточніть картку за брендом.'
                              : 'Новий артикул. Прив’яжіть його до товару один раз.'}
                          </p>
                          <Input
                            aria-label="Пошук товару для прив’язки"
                            placeholder="Назва, бренд або основний артикул"
                            value={queries[i] || ''}
                            onChange={(e) => setQueries({ ...queries, [i]: e.target.value })}
                          />
                          <select
                            aria-label="Прив’язати до товару"
                            className={selectClass}
                            value=""
                            onChange={(e) => {
                              const p = parts.find((p) => p.id === e.target.value)
                              if (p) patch(i, { partId: p.id, name: p.name, unit: p.unit || 'шт' })
                            }}
                          >
                            <option value="">Оберіть товар для цього артикула</option>
                            {(matchArticle(parts, doc.supplierId, l.article).length > 1
                              ? matchArticle(parts, doc.supplierId, l.article)
                              : parts
                            )
                              .filter((p) =>
                                [p.name, p.brand.name, p.partNumber, p.barcode]
                                  .join(' ')
                                  .toLowerCase()
                                  .includes((queries[i] || '').toLowerCase())
                              )
                              .map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name} · {p.brand.name}
                                </option>
                              ))}
                          </select>
                        </div>
                      )
                    )}
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
                  {money(lineCents(l) ?? BigInt(0))}
                </p>
              </div>
              {l.kind === 'part' &&
                !!doc.supplierId &&
                !!l.article.trim() &&
                !l.partId &&
                matchArticle(parts, doc.supplierId, l.article).length === 0 && (
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
        </section>
        <section className="rounded-xl border-2 border-border bg-muted/30 p-5 space-y-4">
          <h2 className="text-lg font-semibold">3. Підсумок і проведення</h2>
          <p className="text-xl font-semibold">
            Разом {money(doc.lines.reduce((s, l) => s + (lineCents(l) ?? BigInt(0)), BigInt(0)))}{' '}
            грн
          </p>
          <div className="flex gap-3">
            <Button type="submit" variant="outline" value="draft">
              Зберегти чернетку
            </Button>
            {canPost && (
              <Button type="submit" value="post">
                Зберегти й провести
              </Button>
            )}
          </div>
        </section>
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
