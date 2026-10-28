'use client'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Wrench, Plus, Layers, Pencil, ArrowUp, ArrowDown, AlertTriangle, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { AppCard } from '@/components/app-card'
import { useFormatCurrency } from '@/components/currency-settings-context'
import { useShopFeeLocked, ShopFeeTag } from '@/features/settings/Components/ShopFeeTag'
import { isShopFeeLine } from '@/features/settings/Lib/shopFee'
import { lineTotal } from '@/features/inventory/Lib/partPricing'
import { serviceLaborSchema, type ServiceLaborInput } from '../../Schema/serviceSchema'
import { makeEmptyLabor, makeEmptyService } from './form-types'
import { LineEditorDialog, LineField } from './LineEditorDialog'
import { LaborNumberInput } from './LaborNumberInput'
import { WorkSubcontract } from '@/features/stock-ledger/Components/WorkSubcontract'
import { LaborQuickAdd, type LaborQuickAddProps } from './LaborQuickAdd'

interface LaborEditorProps {
  stockLedgerRecordId?: string
  laborItems: ServiceLaborInput[]
  setLaborItems: React.Dispatch<React.SetStateAction<ServiceLaborInput[]>>
  updateLabor: (index: number, field: keyof ServiceLaborInput, value: string | number) => void
  laborSubtotal: number
  currencyCode: string
  defaultLaborRate: number
  quickAdd?: Omit<LaborQuickAddProps, 'onAdd' | 'currencyCode' | 'locked'>
  hasPresets?: boolean
  onOpenPresets?: () => void
  onAddFinding?: () => void
  openObservationsCount?: number
  onShowExistingObservations?: () => void
  technicians?: { id: string; name: string }[]
  primaryTechnicianId?: string | null
  locked?: boolean
}
export function LaborEditor({
  stockLedgerRecordId,
  laborItems,
  setLaborItems,
  laborSubtotal,
  currencyCode,
  defaultLaborRate,
  quickAdd,
  hasPresets,
  onOpenPresets,
  onAddFinding,
  openObservationsCount,
  onShowExistingObservations,
  technicians = [],
  primaryTechnicianId,
  locked = false,
}: LaborEditorProps) {
  const t = useTranslations('service.labor'),
    e = useTranslations('service.lineEditor'),
    format = useFormatCurrency(),
    feeLocked = useShopFeeLocked()
  const [editing, setEditing] = useState<{
      index: number
      original: ServiceLaborInput
      draft: ServiceLaborInput
    } | null>(null),
    [error, setError] = useState('')
  useEffect(() => {
    if (locked) setEditing(null)
  }, [locked])
  const draft = editing?.draft,
    isFee = draft ? isShopFeeLine(draft) : false
  const executor = (l: ServiceLaborInput) =>
    isShopFeeLine(l)
      ? '—'
      : l.executorFrozen
        ? l.executorName || e('unassigned')
        : technicians.find((t) => t.id === (l.technicianId || primaryTechnicianId))?.name ||
          l.executorName ||
          e('unassigned')
  const mode = (l: ServiceLaborInput) =>
    isShopFeeLine(l)
      ? ''
      : l.executorLegacy
        ? e('legacyExecutor')
        : l.executorFrozen
          ? e('frozenExecutor')
          : l.technicianId
            ? ''
            : e('inherited')
  function open(index: number, line: ServiceLaborInput) {
    setError('')
    setEditing({ index, original: { ...line }, draft: { ...line } })
  }
  function change(field: keyof ServiceLaborInput, value: string | number | null) {
    setError('')
    setEditing((current) => {
      if (!current) return current
      const next = { ...current.draft, [field]: value }
      if (field === 'hours' || field === 'rate') next.total = lineTotal(next.hours, next.rate)
      if (field === 'technicianId') {
        next.executorFrozen = false
        next.executorLegacy = false
        next.executorName = null
      }
      return { ...current, draft: next }
    })
  }
  function save() {
    if (!editing || locked) return
    const parsed = serviceLaborSchema.safeParse(editing.draft)
    if (!parsed.success) {
      setError(e('invalid'))
      return
    }
    setLaborItems((prev) =>
      editing.index < 0
        ? [...prev, parsed.data]
        : prev.map((l, i) => (i === editing.index ? parsed.data : l))
    )
    setEditing(null)
  }
  function setNumber(index: number, field: 'hours' | 'rate', value: number) {
    if (locked) return
    setLaborItems((prev) =>
      prev.map((line, i) => {
        if (i !== index) return line
        const next = { ...line, [field]: value }
        return { ...next, total: lineTotal(next.hours, next.rate) }
      })
    )
  }
  function move(index: number, delta: number) {
    setLaborItems((prev) => {
      const next = [...prev]
      ;[next[index], next[index + delta]] = [next[index + delta], next[index]]
      return next
    })
  }
  const controls = (l: ServiceLaborInput, i: number) => (
    <div className="flex gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11"
        aria-label={`${e('edit')}: ${l.description}`}
        onClick={() => open(i, l)}
      >
        <Pencil className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11"
        aria-label={e('up')}
        disabled={i === 0 || isShopFeeLine(l)}
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
        disabled={
          i === laborItems.length - 1 || isShopFeeLine(l) || isShopFeeLine(laborItems[i + 1])
        }
        onClick={() => move(i, 1)}
      >
        <ArrowDown className="size-4" />
      </Button>
    </div>
  )
  const actions = (
    <div className="flex max-w-[132px] flex-wrap justify-end gap-1 sm:max-w-none">
      {hasPresets && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11"
          aria-label={t('fromPresets')}
          onClick={onOpenPresets}
        >
          <Layers className="size-4" />
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-11"
        aria-label={t('addLabor')}
        onClick={() => open(-1, makeEmptyLabor(defaultLaborRate))}
      >
        <Plus className="size-4" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-11"
        aria-label={t('addService')}
        onClick={() => open(-1, makeEmptyService())}
      >
        <Wrench className="size-4" />
      </Button>
      {onAddFinding && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11"
          aria-label={t('addFinding')}
          onClick={onAddFinding}
        >
          <AlertTriangle className="size-4" />
        </Button>
      )}
      {!!openObservationsCount && (
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          aria-label={t('addExisting', { count: openObservationsCount })}
          onClick={onShowExistingObservations}
        >
          <Eye className="size-4" />
          {openObservationsCount}
        </Button>
      )}
    </div>
  )
  return (
    <AppCard
      icon={Wrench}
      title={t('title')}
      badge={laborItems.length || undefined}
      action={actions}
      className="@container min-w-0"
      contentClassName="p-3"
    >
      {quickAdd && (
        <LaborQuickAdd
          {...quickAdd}
          currencyCode={currencyCode}
          locked={locked}
          onAdd={(line) => setLaborItems((prev) => [...prev, line])}
        />
      )}
      <table className="hidden w-full table-fixed text-sm @[850px]:table">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            {[
              t('description'),
              e('executor'),
              t('qtyOrHours'),
              e('price'),
              t('total'),
              e('actions'),
            ].map((label, i) => (
              <th key={i} className={`p-2 ${i === 0 ? 'w-[30%]' : i === 5 ? 'w-[140px]' : ''}`}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {laborItems.map((l, i) => (
            <tr
              key={l.id ?? i}
              className="border-b align-top hover:bg-muted/40"
              onDoubleClick={(event) => {
                if (!locked && !(event.target as HTMLElement).closest('input,button')) open(i, l)
              }}
            >
              <td className="p-2">
                <button
                  type="button"
                  className="min-h-11 w-full break-words text-left font-medium"
                  onClick={() => open(i, l)}
                >
                  {l.description || e('unnamed')}
                </button>
                {isShopFeeLine(l) && <ShopFeeTag />}
              </td>
              <td className="break-words p-2">
                {executor(l)}
                {l.executionType==='SUBCONTRACT'&&<span className="block text-xs">Підрядник</span>}
                <span className="block text-xs text-muted-foreground">{mode(l)}</span>
              </td>
              <td className="p-2">
                <LaborNumberInput
                  label={`${t('qtyOrHours')}: ${l.description}`}
                  value={l.hours}
                  disabled={locked || isShopFeeLine(l)}
                  onCommit={(value) => setNumber(i, 'hours', value)}
                />
                <span className="text-xs text-muted-foreground">
                  {l.pricingType === 'hourly' ? e('hours') : e('pieces')}
                </span>
              </td>
              <td className="p-2 tabular-nums">
                <LaborNumberInput
                  label={`${e('price')}: ${l.description}`}
                  value={l.rate}
                  disabled={locked || (isShopFeeLine(l) && feeLocked)}
                  onCommit={(value) => setNumber(i, 'rate', value)}
                />
              </td>
              <td className="p-2 font-semibold tabular-nums">{format(l.total, currencyCode)}</td>
              <td>{controls(l, i)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="space-y-3 @[850px]:hidden">
        {laborItems.map((l, i) => (
          <article key={l.id ?? i} className="rounded-lg border p-3">
            <button
              type="button"
              className="min-h-11 w-full break-words text-left font-medium"
              onClick={() => open(i, l)}
            >
              {l.description || e('unnamed')}
            </button>
            {isShopFeeLine(l) && <ShopFeeTag />}
            <p className="mt-2 break-words text-sm">
              {e('executor')}: {executor(l)}{' '}
              {l.executionType==='SUBCONTRACT'&&<span className="block text-xs">Підрядник</span>}
              <span className="text-xs text-muted-foreground">{mode(l)}</span>
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              {[
                [
                  t('qtyOrHours'),
                  `${l.hours} ${l.pricingType === 'hourly' ? e('hours') : e('pieces')}`,
                ],
                [e('price'), format(l.rate, currencyCode)],
                [t('total'), format(l.total, currencyCode)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 font-medium tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-2 flex justify-end">{controls(l, i)}</div>
          </article>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => open(-1, makeEmptyService())}
        >
          <Plus className="size-4" />
          {t('addService')}
        </Button>
        <strong className="text-sm">
          {t('subtotal', { amount: format(laborSubtotal, currencyCode) })}
        </strong>
      </div>
      {editing && draft && (
        <LineEditorDialog
          title={editing.index < 0 ? t('addService') : e('editLabor')}
          dirty={JSON.stringify(editing.original) !== JSON.stringify(draft)}
          error={error}
          onCancel={() => setEditing(null)}
          onSave={save}
          onDelete={
            editing.index < 0
              ? undefined
              : () => {
                  setLaborItems((prev) => prev.filter((_, i) => i !== editing.index))
                  setEditing(null)
                }
          }
        >
          <LineField label={t('description')}>
            <Textarea
              value={draft.description}
              onChange={(v) => change('description', v.target.value)}
            />
          </LineField>
          {!isFee && (
            <>
              {stockLedgerRecordId && (
                <>
                  <LineField label="Тип виконання">
                    <select
                      className="min-h-11 rounded border bg-background p-2"
                      value={draft.executionType ?? 'INTERNAL'}
                      onChange={(ev) => change('executionType', ev.target.value)}
                    >
                      <option value="INTERNAL">Власна майстерня</option>
                      <option value="SUBCONTRACT">Підрядник</option>
                    </select>
                  </LineField>
                  {draft.executionType === 'SUBCONTRACT' && (
                    <WorkSubcontract
                      recordId={stockLedgerRecordId}
                      laborId={draft.id}
                      description={draft.description}
                    />
                  )}
                </>
              )}
              <LineField label={e('executor')}>
                <select
                  className="min-h-11 rounded-md border bg-background px-2"
                  value={draft.technicianId ?? ''}
                  onChange={(v) => change('technicianId', v.target.value || null)}
                >
                  <option value="">
                    {e('inherited')} —{' '}
                    {technicians.find((t) => t.id === primaryTechnicianId)?.name || e('unassigned')}
                  </option>
                  {draft.technicianId && !technicians.some((t) => t.id === draft.technicianId) && (
                    <option value={draft.technicianId} disabled>
                      {draft.executorName || e('inactive')}
                    </option>
                  )}
                  {technicians.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </LineField>
              {draft.executorFrozen && (
                <p className="text-sm text-muted-foreground">
                  {mode(draft)}: {executor(draft)}
                </p>
              )}
              <LineField label={e('pricingType')}>
                <select
                  className="min-h-11 rounded-md border bg-background px-2"
                  value={draft.pricingType}
                  onChange={(v) => change('pricingType', v.target.value)}
                >
                  <option value="hourly">{t('hourlyTag')}</option>
                  <option value="service">{t('serviceTag')}</option>
                </select>
              </LineField>
            </>
          )}
          <div className="grid grid-cols-2 gap-4">
            <LineField label={draft.pricingType === 'hourly' ? t('hours') : t('qty')}>
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                disabled={isFee}
                value={draft.hours}
                onChange={(v) => change('hours', v.target.value)}
              />
            </LineField>
            <LineField label={e('price')}>
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                disabled={isFee && feeLocked}
                value={draft.rate}
                onChange={(v) => change('rate', v.target.value)}
              />
            </LineField>
          </div>
          <p className="flex justify-between gap-3 font-semibold">
            <span>{t('total')}</span>
            <span>{format(draft.total, currencyCode)}</span>
          </p>
        </LineEditorDialog>
      )}
    </AppCard>
  )
}
