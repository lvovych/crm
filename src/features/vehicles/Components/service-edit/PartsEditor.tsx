'use client'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Package, Plus, ScanBarcode, Pencil, ArrowUp, ArrowDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { AppCard } from '@/components/app-card'
import { useFormatCurrency } from '@/components/currency-settings-context'
import { BrandCombobox } from '@/features/inventory/Components/BrandCombobox'
import {
  PartNameSuggestions,
  type PartSuggestion,
} from '@/features/inventory/Components/PartNameSuggestions'
import { repricePartRow, resolvePartPrice } from '@/features/inventory/Lib/partPricing'
import { discountedPartTotal, partPriceChanged } from '../../Lib/lineDiscount'
import { servicePartSchema, type ServicePartInput } from '../../Schema/serviceSchema'
import { emptyPart } from './form-types'
import { LineEditorDialog, LineField } from './LineEditorDialog'

interface PartsEditorProps {
  partItems: ServicePartInput[]
  setPartItems: React.Dispatch<React.SetStateAction<ServicePartInput[]>>
  updatePart: (
    index: number,
    field: keyof ServicePartInput,
    value: string | number,
    options?: { commit?: boolean }
  ) => void
  partsSubtotal: number
  currencyCode: string
  hasInventory: boolean
  inventoryParts?: PartSuggestion[]
  onOpenInventory: () => void
  onScanBarcode?: () => void
  defaultMarkupPercent?: number
  markupAppliesToInventory?: boolean
  pendingPart?: ServicePartInput | null
  onPendingPartConsumed?: () => void
  locked?: boolean
}
export function PartsEditor({
  partItems,
  setPartItems,
  partsSubtotal,
  currencyCode,
  hasInventory,
  inventoryParts = [],
  onOpenInventory,
  onScanBarcode,
  defaultMarkupPercent = 0,
  markupAppliesToInventory = false,
  pendingPart,
  onPendingPartConsumed,
  locked = false,
}: PartsEditorProps) {
  const t = useTranslations('service.parts'),
    e = useTranslations('service.lineEditor'),
    format = useFormatCurrency()
  const [editing, setEditing] = useState<{
    index: number
    original: ServicePartInput
    draft: ServicePartInput
  } | null>(null)
  const [error, setError] = useState('')
  function open(index: number, p: ServicePartInput) {
    setError('')
    setEditing({ index, original: { ...p }, draft: { ...p } })
  }
  useEffect(() => {
    if (pendingPart) {
      open(-1, pendingPart)
      onPendingPartConsumed?.()
    }
  }, [pendingPart])
  useEffect(() => {
    if (locked) setEditing(null)
  }, [locked])
  const draft = editing?.draft
  const dirty = !!editing && JSON.stringify(editing.draft) !== JSON.stringify(editing.original)
  function change(field: keyof ServicePartInput, value: string | number) {
    setError('')
    setEditing((current) => {
      if (!current) return current
      let next = { ...current.draft, [field]: value }
      if (['unitCost', 'markupPercent', 'unitPrice'].includes(field))
        next = {
          ...next,
          ...repricePartRow(next, field as 'unitCost' | 'markupPercent' | 'unitPrice', {
            commit: true,
          }),
        }
      if (
        [
          'quantity',
          'unitCost',
          'markupPercent',
          'unitPrice',
          'discountType',
          'discountValue',
        ].includes(field)
      ) {
        try {
          next.total = discountedPartTotal(next)
        } catch {
          /* Invalid input stays visible until fixed. */
        }
      }
      return { ...current, draft: next }
    })
  }
  function save() {
    if (!editing || locked) return
    const parsed = servicePartSchema.safeParse(editing.draft)
    if (!parsed.success) {
      setError(e('invalid'))
      return
    }
    try {
      const total = discountedPartTotal(parsed.data)
      const next = {
        ...editing.draft,
        ...parsed.data,
        total:
          editing.index >= 0 && !partPriceChanged(parsed.data, editing.original)
            ? editing.original.total
            : total,
      }
      setPartItems((prev) =>
        editing.index < 0 ? [...prev, next] : prev.map((p, i) => (i === editing.index ? next : p))
      )
      setEditing(null)
    } catch {
      setError(e('invalidDiscount'))
    }
  }
  function move(index: number, delta: number) {
    setPartItems((prev) => {
      const next = [...prev]
      ;[next[index], next[index + delta]] = [next[index + delta], next[index]]
      return next
    })
  }
  const discount = (p: ServicePartInput) =>
    p.discountType === 'percentage'
      ? `${p.discountValue ?? 0}%`
      : p.discountType === 'fixed'
        ? format(p.discountValue ?? 0, currencyCode)
        : '—'
  const actions = (
    <div className="flex flex-wrap gap-1">
      {hasInventory && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11"
          aria-label={t('fromInventory')}
          onClick={onOpenInventory}
        >
          <Package className="size-4" />
        </Button>
      )}
      {onScanBarcode && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11"
          aria-label={t('scanBarcode')}
          onClick={onScanBarcode}
        >
          <ScanBarcode className="size-4" />
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-11"
        aria-label={t('addPart')}
        onClick={() => open(-1, emptyPart(defaultMarkupPercent))}
      >
        <Plus className="size-4" />
      </Button>
    </div>
  )
  const controls = (p: ServicePartInput, i: number) => (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11"
        aria-label={`${e('edit')}: ${p.name}`}
        onClick={() => open(i, p)}
      >
        <Pencil className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11"
        aria-label={e('up')}
        disabled={i === 0}
        onClick={() => move(i, -1)}
      >
        <ArrowUp className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11"
        aria-label={e('down')}
        disabled={i === partItems.length - 1}
        onClick={() => move(i, 1)}
      >
        <ArrowDown className="size-4" />
      </Button>
    </div>
  )
  return (
    <AppCard
      icon={Package}
      title={t('title')}
      badge={partItems.length || undefined}
      action={actions}
      className="@container min-w-0"
      contentClassName="p-3"
    >
      <table className="hidden w-full table-fixed text-sm @[1000px]:table">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            {[
              t('partNumber'),
              e('brand'),
              t('name'),
              t('qty'),
              t('unitPrice'),
              e('discount'),
              e('netTotal'),
              e('actions'),
            ].map((label, i) => (
              <th key={i} className={`p-2 ${i === 2 ? 'w-[24%]' : i === 7 ? 'w-[140px]' : ''}`}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {partItems.map((p, i) => (
            <tr
              key={p.id ?? i}
              className="border-b align-top hover:bg-muted/40"
              onDoubleClick={() => !locked && open(i, p)}
            >
              <td className="break-words p-2">{p.partNumber || '—'}</td>
              <td className="break-words p-2">{p.brand || '---'}</td>
              <td className="p-2">
                <button
                  type="button"
                  disabled={locked}
                  className="min-h-11 w-full break-words text-left font-medium"
                  onClick={() => open(i, p)}
                >
                  {p.name || e('unnamed')}
                </button>
              </td>
              <td className="p-2 tabular-nums">
                {p.quantity} {p.unit}
              </td>
              <td className="p-2 tabular-nums">{format(p.unitPrice, currencyCode)}</td>
              <td className="p-2">{discount(p)}</td>
              <td className="p-2 font-semibold tabular-nums">{format(p.total, currencyCode)}</td>
              <td>{controls(p, i)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="space-y-3 @[1000px]:hidden">
        {partItems.map((p, i) => (
          <article key={p.id ?? i} className="rounded-lg border p-3">
            <button
              type="button"
              className="min-h-11 w-full break-words text-left"
              onClick={() => open(i, p)}
            >
              <span className="block text-xs text-muted-foreground">
                {p.partNumber || '—'} · {p.brand || '---'}
              </span>
              <span className="mt-1 block font-medium">{p.name || e('unnamed')}</span>
            </button>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              {[
                [t('qty'), `${p.quantity} ${p.unit ?? ''}`],
                [t('unitPrice'), format(p.unitPrice, currencyCode)],
                [e('discount'), discount(p)],
                [e('netTotal'), format(p.total, currencyCode)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 break-words font-medium tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-2 flex justify-end">{controls(p, i)}</div>
          </article>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => open(-1, emptyPart(defaultMarkupPercent))}
        >
          <Plus className="size-4" />
          {t('addPart')}
        </Button>
        <strong className="text-sm">
          {t('subtotal', { amount: format(partsSubtotal, currencyCode) })}
        </strong>
      </div>
      {editing && draft && (
        <LineEditorDialog
          title={editing.index < 0 ? t('addPart') : e('editPart')}
          dirty={dirty}
          error={error}
          onCancel={() => setEditing(null)}
          onSave={save}
          onDelete={
            editing.index < 0
              ? undefined
              : () => {
                  setPartItems((prev) => prev.filter((_, i) => i !== editing.index))
                  setEditing(null)
                }
          }
        >
          <div className="relative">
            <LineField label={t('name')}>
              <Textarea value={draft.name} onChange={(v) => change('name', v.target.value)} />
            </LineField>
            <PartNameSuggestions
              query={draft.name}
              parts={inventoryParts}
              disabled={!!draft.inventoryPartId}
              currencyCode={currencyCode}
              defaultMarkupPercent={defaultMarkupPercent}
              markupAppliesToInventory={markupAppliesToInventory}
              onSelect={(picked) => {
                const price = resolvePartPrice(picked, {
                  defaultMarkupPercent,
                  markupAppliesToInventory,
                })
                const next = {
                  ...draft,
                  ...price,
                  name: picked.name,
                  partNumber: picked.partNumber ?? '',
                  brand: picked.brand?.name ?? '---',
                  unit: picked.unit,
                  unitCost: picked.unitCost,
                  inventoryPartId: picked.id,
                }
                setEditing({ ...editing, draft: { ...next, total: discountedPartTotal(next) } })
              }}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <LineField label={t('partNumber')}>
              <Input
                value={draft.partNumber ?? ''}
                onChange={(v) => change('partNumber', v.target.value)}
              />
            </LineField>
            <LineField label={e('brand')}>
              <BrandCombobox
                snapshot
                value={draft.brand ?? '---'}
                onChange={(v) => change('brand', v)}
              />
            </LineField>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <LineField label={t('qty')}>
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={draft.quantity}
                onChange={(v) => change('quantity', v.target.value)}
              />
            </LineField>
            <LineField label={e('unit')}>
              <Input value={draft.unit ?? ''} onChange={(v) => change('unit', v.target.value)} />
            </LineField>
          </div>
          <LineField label={t('unitPrice')}>
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={draft.unitPrice}
              onChange={(v) => change('unitPrice', v.target.value)}
            />
          </LineField>
          <div className="grid grid-cols-2 gap-4">
            <LineField label={e('discount')}>
              <select
                className="min-h-11 rounded-md border bg-background px-2"
                value={draft.discountType ?? 'none'}
                onChange={(v) => {
                  change('discountValue', 0)
                  change('discountType', v.target.value)
                }}
              >
                {['none', 'percentage', 'fixed'].map((v) => (
                  <option key={v} value={v}>
                    {e(v)}
                  </option>
                ))}
              </select>
            </LineField>
            <LineField label={e('discountValue')}>
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                disabled={!draft.discountType || draft.discountType === 'none'}
                value={draft.discountValue ?? 0}
                onChange={(v) => change('discountValue', v.target.value)}
              />
            </LineField>
          </div>
          <details className="rounded-lg border p-3">
            <summary className="min-h-11 cursor-pointer text-sm font-medium">
              {e('internal')}
            </summary>
            <div className="space-y-4">
              <LineField label={t('unitCost')}>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.unitCost}
                  onChange={(v) => change('unitCost', v.target.value)}
                />
              </LineField>
              <LineField label={t('markupPercent')}>
                <Input
                  type="number"
                  min="-100"
                  step="0.1"
                  value={draft.markupPercent}
                  onChange={(v) => change('markupPercent', v.target.value)}
                />
              </LineField>
              <p className="break-all text-xs text-muted-foreground">
                {e('inventory')}: {draft.inventoryPartId ?? '—'}
              </p>
            </div>
          </details>
          {editing.index >= 0 &&
            Math.abs(
              editing.original.total -
                Number(editing.original.quantity) * Number(editing.original.unitPrice)
            ) > 0.01 &&
            (!editing.original.discountType || editing.original.discountType === 'none') && (
              <p className="text-sm text-amber-600">{e('historical')}</p>
            )}
          <p className="flex justify-between gap-3 font-semibold">
            <span>{e('netTotal')}</span>
            <span>{format(draft.total, currencyCode)}</span>
          </p>
        </LineEditorDialog>
      )}
    </AppCard>
  )
}
