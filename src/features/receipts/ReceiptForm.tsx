'use client'
import { lineCents } from './money'
import { matchArticle } from './articles'
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { saveDraft, type receiptOptions } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Options = NonNullable<Awaited<ReturnType<typeof receiptOptions>>['data']>
type Line = {
  brandId?: string
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
  const [doc, setDoc] = useState<Draft>(() => ({
    ...initial,
    lines: initial.lines.map((l) => ({
      ...l,
      brandId: l.brandId || options.parts.find((p) => p.id === l.partId)?.brandId || '',
    })),
  }))
  const parts = options.parts
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
    const matches = matchArticle(parts, supplierId, l.article, l.brandId)
    const part = matches.length === 1 ? matches[0] : null
    return {
      ...l,
      partId: part?.id ?? null,
      brandId: part?.brandId || l.brandId || '',
      name: part?.name ?? (l.partId ? '' : l.name),
      unit: part?.unit || (l.partId ? 'шт' : l.unit),
      unitPrice: part
        ? part.id === l.partId
          ? l.unitPrice
          : String(part.unitCost)
        : l.partId
          ? '0'
          : l.unitPrice,
    }
  }
  function save(post: boolean) {
    start(async () => {
      setError('')
      setDuplicate('')
      const r = await saveDraft(
        {
          ...doc,
          lines: doc.lines.map((l) => ({
            ...l,
            brandId: l.kind === 'part' && l.brandId ? l.brandId : undefined,
          })),
        },
        post
      )
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
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
        save(submitter?.value === 'post')
      }}
    >
      <fieldset disabled={busy} className="min-w-0 space-y-5">
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
            Введіть артикул — назва, бренд, одиниця та закупівельна ціна заповняться з картки
            товару. Кількість і ціну перевірте за накладною.
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
                  }}
                >
                  Видалити рядок
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)] lg:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)]">
                <label>
                  Тип
                  <select
                    className={selectClass}
                    value={l.kind}
                    onChange={(e) =>
                      patch(i, {
                        kind: e.target.value as Line['kind'],
                        partId: null,
                        brandId: '',
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
                          patch(
                            i,
                            resolve(
                              { ...l, article: e.target.value, brandId: l.partId ? '' : l.brandId },
                              doc.supplierId
                            )
                          )
                        }
                      />
                    </label>
                    <label>
                      Бренд
                      <select
                        required
                        className={selectClass}
                        value={l.brandId || ''}
                        onChange={(e) =>
                          patch(i, resolve({ ...l, brandId: e.target.value }, doc.supplierId))
                        }
                      >
                        <option value="">Оберіть бренд</option>
                        {options.brands
                          .filter((b) => b.isActive || b.id === l.brandId)
                          .map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                      </select>
                    </label>
                  </>
                )}
              </div>
              <div className="grid gap-3 md:grid-cols-5">
                <label>
                  Назва
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
              {l.kind === 'part' && l.article.trim() && (
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  {l.partId
                    ? 'Товар знайдено. Дані заповнено зі складської картки.'
                    : matchArticle(parts, doc.supplierId, l.article, l.brandId).length > 1
                      ? 'Знайдено кілька карток. Уточніть бренд. Якщо бренд однаковий — перевірте дублікати в довіднику товарів.'
                      : 'Новий товар. Заповніть назву й бренд — картка створиться під час збереження. Залишок збільшиться лише після проведення накладної.'}
                </p>
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
