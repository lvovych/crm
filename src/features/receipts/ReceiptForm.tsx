'use client'
import { useOperationText } from '@/i18n/use-operation-text'
import { lineCents } from './money'
import { matchArticle } from './articles'
import { useState, useTransition, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { saveDraft, type receiptOptions } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, Trash2, CheckCircle2, ChevronDown } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandItem,
} from '@/components/ui/command'

function DirectorySelect({
  label,
  value,
  items,
  onChange,
}: {
  label: string
  value: string
  items: { id: string; name: string }[]
  onChange: (id: string) => void
}) {
  const ot = useOperationText()

  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          className="w-full min-w-0 justify-between border-foreground/25 bg-background font-normal"
        >
          <span className="truncate">
            {items.find((item) => item.id === value)?.name || ot('Оберіть…')}
          </span>
          <ChevronDown className="size-4 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(360px,85vw)] p-0">
        <Command>
          <CommandInput
            aria-label={ot('Пошук: ') + label + ''}
            placeholder={ot('Пошук за назвою…')}
          />
          <CommandList>
            <CommandEmpty>{ot('Нічого не знайдено')}</CommandEmpty>
            {items.map((item) => (
              <CommandItem
                key={item.id}
                value={item.id}
                keywords={[item.name]}
                onSelect={() => {
                  onChange(item.id)
                  setOpen(false)
                }}
              >
                {item.name}
                {item.id === value && <CheckCircle2 className="ml-auto size-4" />}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

type Options = NonNullable<Awaited<ReturnType<typeof receiptOptions>>['data']>
type Line = {
  brandSnapshot?: string | null
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
  source?: string
  id: string
  version: number
  supplierId: string
  number: string
  documentDate: string
  receivedDate: string
  lines: Line[]
}
const blank = (kind: Line['kind'] = 'part'): Line => ({
  kind,
  article: '',
  name: '',
  partId: null,
  quantity: '1',
  unitPrice: '0',
  unit: kind === 'service' ? 'посл.' : 'шт',
})
const selectClass = 'h-9 w-full rounded-md border border-foreground/25 bg-background px-2 text-sm'
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
  const ot = useOperationText()

  const router = useRouter()
  const [doc, setDoc] = useState<Draft>(() => ({
    ...initial,
    lines: initial.lines.map((l) => ({
      ...l,
      brandId: l.brandId || options.parts.find((p) => p.id === l.partId)?.brandId || options.brands.find(b => b.name.toUpperCase() === l.brandSnapshot?.toUpperCase())?.id || '',
    })),
  }))
  const formRef = useRef<HTMLFormElement>(null)
  const focusNewLine = useRef(false)
  useEffect(() => {
    if (focusNewLine.current) {
      formRef.current
        ?.querySelector<HTMLInputElement>(`[data-article-index="${doc.lines.length - 1}"]`)
        ?.focus()
      focusNewLine.current = false
    }
  }, [doc.lines.length])
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
      unit: part?.unit || (l.partId ? ot('шт') : l.unit),
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
    const missing = !doc.supplierId
      ? ot('Оберіть постачальника.')
      : doc.lines.some((l) => l.kind === 'part' && !l.brandId)
        ? ot('Оберіть бренд для кожної запчастини.')
        : ''
    if (missing) {
      setError(missing)
      return
    }
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
        setError(r.error || ot('Помилка збереження'))
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
      ref={formRef}
      className="flex flex-col gap-6 pb-20 md:pb-0 [&_input]:border-foreground/25 [&_input]:bg-background"
      onSubmit={(e) => {
        e.preventDefault()
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
        save(submitter?.value === 'post')
      }}
    >
      <fieldset disabled={busy} className="min-w-0 space-y-6">
        <section className="space-y-4 rounded-xl border border-foreground/20 bg-muted/60 p-5">
          <h2 className="text-lg font-semibold">{ot('Дані накладної')}</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1fr] [&_label]:space-y-1.5 [&_label]:text-sm [&_label]:font-medium">
            <div className="space-y-1.5 text-sm font-medium">
              <span>{ot('Постачальник')}</span>
              <DirectorySelect
                label={ot('Постачальник')}
                value={doc.supplierId}
                items={options.suppliers}
                onChange={(value) => field('supplierId', value)}
              />
              {error && !doc.supplierId && (
                <p className="text-destructive">{ot('Оберіть постачальника')}</p>
              )}
            </div>
            <label>
              {ot('Номер накладної')}
              <Input
                required
                maxLength={100}
                value={doc.number}
                readOnly={doc.source === 'ukrcar'}
                onChange={(e) => field('number', e.target.value)}
              />
            </label>
            <label>
              {ot('Дата документа')}
              <Input
                required
                type="date"
                value={doc.documentDate}
                onChange={(e) => field('documentDate', e.target.value)}
              />
            </label>
            <label>
              {ot('Дата приймання')}
              <Input
                required
                type="date"
                value={doc.receivedDate}
                onChange={(e) => field('receivedDate', e.target.value)}
              />
            </label>
          </div>
        </section>
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">
              {ot('Товари та послуги')}{' '}
              <span className="ml-2 rounded-md bg-muted px-2 py-0.5 text-sm">
                {doc.lines.length}
              </span>
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {ot(
                'Введіть артикул — дані товару заповняться автоматично. Перевірте кількість і ціну.'
              )}
            </p>
          </div>
          <div className="overflow-hidden rounded-xl border border-foreground/20">
            <div
              aria-hidden="true"
              className="hidden grid-cols-[7rem_1.2fr_1.2fr_2fr_3.5rem_5rem_6rem_6rem_2.5rem] gap-2 bg-muted/80 px-4 py-3 text-xs font-semibold min-[90rem]:grid"
            >
              {[
                ot('Тип'),
                ot('Артикул'),
                ot('Бренд'),
                ot('Назва'),
                ot('Од.'),
                ot('Кількість'),
                ot('Ціна, грн'),
                ot('Сума, грн'),
                '',
              ].map((title, i) => (
                <span key={i}>{title}</span>
              ))}
            </div>
            {doc.lines.map((l, i) => (
              <section
                key={i}
                aria-label={ot('Позиція ') + (i + 1) + ''}
                className="space-y-2 border-b border-foreground/20 bg-card p-4 last:border-b-0 hover:bg-muted/30 focus-within:bg-muted/30"
              >
                <div className="grid grid-cols-2 items-start gap-3 sm:grid-cols-6 min-[90rem]:grid-cols-[7rem_1.2fr_1.2fr_2fr_3.5rem_5rem_6rem_6rem_2.5rem] min-[90rem]:gap-2 [&_label]:min-w-0 [&_label]:space-y-1.5 [&_label]:text-sm">
                  <label className="sm:col-span-2 min-[90rem]:col-span-1">
                    <span className="min-[90rem]:sr-only">{ot('Тип')}</span>
                    <select
                      className={selectClass}
                      value={l.kind}
                      disabled={
                        doc.lines.length > 1 && doc.lines.every((line) => line.kind === l.kind)
                      }
                      onChange={(e) =>
                        patch(i, {
                          kind: e.target.value as Line['kind'],
                          partId: null,
                          brandId: '',
                          article: '',
                          name: '',
                          unit: e.target.value === 'service' ? ot('посл.') : ot('шт'),
                        })
                      }
                    >
                      <option value="part">{ot('Запчастина')}</option>
                      <option value="service">{ot('Послуга')}</option>
                    </select>
                  </label>
                  <label className="sm:col-span-2 min-[90rem]:col-span-1">
                    <span className="min-[90rem]:sr-only">{ot('Артикул')}</span>
                    <Input
                      data-article-index={i}
                      required={l.kind === 'part'}
                      disabled={l.kind === 'service'}
                      maxLength={120}
                      value={l.article}
                      placeholder={l.kind === 'part' ? 'FE 12345' : '—'}
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
                  <div className="space-y-1.5 text-sm sm:col-span-2 min-[90rem]:col-span-1">
                    <span className="min-[90rem]:sr-only">{ot('Бренд')}</span>
                    {l.kind === 'part' ? (
                      <DirectorySelect
                        label={ot('Бренд')}
                        value={l.brandId || ''}
                        items={options.brands.filter((b) => b.isActive || b.id === l.brandId)}
                        onChange={(value) =>
                          patch(i, resolve({ ...l, brandId: value }, doc.supplierId))
                        }
                      />
                    ) : (
                      <span className="block py-2">—</span>
                    )}
                    {error && l.kind === 'part' && !l.brandId && (
                      <p className="text-destructive">{ot('Оберіть бренд')}</p>
                    )}
                    {l.brandSnapshot && !l.brandId && <p className="text-muted-foreground">{l.brandSnapshot}</p>}
                  </div>
                  <label className="col-span-2 sm:col-span-6 min-[90rem]:col-span-1">
                    <span className="min-[90rem]:sr-only">{ot('Назва')}</span>
                    <Input
                      required
                      value={l.name}
                      onChange={(e) => patch(i, { name: e.target.value })}
                    />
                  </label>
                  <label>
                    <span className="min-[90rem]:sr-only">{ot('Одиниця')}</span>
                    <Input
                      required
                      readOnly={!!l.partId}
                      value={l.unit}
                      onChange={(e) => patch(i, { unit: e.target.value })}
                    />
                  </label>
                  <label>
                    <span className="min-[90rem]:sr-only">{ot('Кількість')}</span>
                    <Input
                      required
                      type="number"
                      min="0.001"
                      step="0.001"
                      value={l.quantity}
                      onChange={(e) => patch(i, { quantity: e.target.value })}
                    />
                  </label>
                  <label className="sm:col-span-2 min-[90rem]:col-span-1">
                    <span className="min-[90rem]:sr-only">{ot('Ціна, грн')}</span>
                    <Input
                      className="text-right tabular-nums"
                      required
                      type="number"
                      min="0"
                      step="0.0001"
                      value={l.unitPrice}
                      onChange={(e) => patch(i, { unitPrice: e.target.value })}
                    />
                  </label>
                  <div className="text-sm">
                    <span className="min-[90rem]:sr-only">{ot('Сума, грн')}</span>
                    <p className="py-2 text-right font-semibold tabular-nums">
                      {money(lineCents(l) ?? BigInt(0))}
                    </p>
                  </div>
                  <Button
                    className="self-end justify-self-end border-foreground/25 hover:border-destructive hover:text-destructive"
                    type="button"
                    variant="outline"
                    size="icon"
                    title={ot('Видалити позицію')}
                    aria-label={ot('Видалити позицію ') + (i + 1) + ''}
                    disabled={doc.lines.length === 1}
                    onClick={() =>
                      setDoc((d) => ({ ...d, lines: d.lines.filter((_, j) => j !== i) }))
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                {l.kind === 'part' && l.article.trim() && (
                  <p
                    className={`text-xs ${l.partId ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-300'}`}
                    aria-live="polite"
                  >
                    {l.partId
                      ? ot('✓ Товар знайдено — дані заповнено з картки.')
                      : matchArticle(parts, doc.supplierId, l.article, l.brandId).length > 1
                        ? ot(
                            'Уточніть бренд — знайдено кілька карток. Якщо бренд однаковий, перевірте дублікати в довіднику.'
                          )
                        : ot('Новий товар — картка створиться під час збереження.')}
                  </p>
                )}
              </section>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            className="border-foreground/30 bg-muted/50"
            onClick={() => {
              focusNewLine.current = true
              setDoc((d) => ({ ...d, lines: [...d.lines, blank(d.lines[0]?.kind)] }))
            }}
          >
            <Plus className="size-4" />
            {ot('Додати позицію')}
          </Button>
        </section>
      </fieldset>
      <section
        aria-label={ot('Підсумок і проведення')}
        className="sticky bottom-20 md:bottom-0 z-20 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-foreground/25 bg-background p-4 shadow-[0_-4px_20px_rgba(0,0,0,0.15)]"
      >
        <div>
          <p className="text-xs text-muted-foreground">
            {ot("Позицій: ")}
            {doc.lines.length}
          </p>
          <p className="text-xl font-semibold tabular-nums">
            {ot("Разом ")}
            {money(doc.lines.reduce((s, l) => s + (lineCents(l) ?? BigInt(0)), BigInt(0)))}{' '}
            {ot('грн')}
          </p>
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy}
              type="submit"
              variant="outline"
              className="border-foreground/30"
              value="draft"
            >
              {busy ? ot('Збереження…') : ot('Зберегти чернетку')}
            </Button>
            {canPost && (
              <Button disabled={busy} type="submit" value="post">
                {ot('Зберегти й провести')}
              </Button>
            )}
          </div>
          {canPost && (
            <p className="text-xs text-muted-foreground">
              {ot('Після проведення товари надійдуть на склад.')}
            </p>
          )}
        </div>
        {error && (
          <p className="w-full text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {duplicate && (
          <Link className="w-full underline" href={'/receipts/' + duplicate}>
            {ot('Така накладна вже є. Відкрити документ')}
          </Link>
        )}
      </section>
    </form>
  )
}
