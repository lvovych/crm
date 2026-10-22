'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Star, Plus } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useFormatCurrency } from '@/components/currency-settings-context'
import type { LaborPresetOption } from '@/features/labor-presets/Components/LaborPresetPickerDialog'
import {
  isLaborPackage,
  laborPresetTotal,
  parseLaborNumber,
  searchLaborPresets,
} from '@/features/labor-presets/Lib/quickLabor'
import { lineTotal } from '@/features/inventory/Lib/partPricing'
import type { ServiceLaborInput } from '../../Schema/serviceSchema'

export interface LaborQuickAddProps {
  presets: LaborPresetOption[]
  currencyCode: string
  locked?: boolean
  onAdd: (line: ServiceLaborInput) => void
  onPackage: (preset: LaborPresetOption) => void
  onSavePreset?: (line: ServiceLaborInput) => Promise<LaborPresetOption>
}

export function LaborQuickAdd({
  presets,
  currencyCode,
  locked,
  onAdd,
  onPackage,
  onSavePreset,
}: LaborQuickAddProps) {
  const t = useTranslations('service.quickLabor'),
    format = useFormatCurrency(),
    id = useId()
  const searchRef = useRef<HTMLInputElement>(null),
    quantityRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState(''),
    [quantity, setQuantity] = useState('1'),
    [price, setPrice] = useState('')
  const [pricingType, setPricingType] = useState<'service' | 'hourly'>('service')
  const [selected, setSelected] = useState<LaborPresetOption | null>(null)
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(0)
  const [favorites, setFavorites] = useState<string[]>([]),
    [recent, setRecent] = useState<string[]>([])
  const [created, setCreated] = useState<LaborPresetOption[]>([])
  const [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false)
  const [saveTypical, setSaveTypical] = useState(false)
  const inFlight = useRef(false)
  const lockedRef = useRef(locked)
  lockedRef.current = locked
  useEffect(() => {
    try {
      for (const [key, setter] of [
        ['favorites', setFavorites],
        ['recent', setRecent],
      ] as const) {
        const value = JSON.parse(localStorage.getItem(`crm.labor.${key}`) || '[]')
        if (Array.isArray(value)) setter(value.filter((v): v is string => typeof v === 'string'))
      }
    } catch {
      /* Storage is optional. */
    }
  }, [])
  const all = useMemo(
    () => [...created, ...presets.filter((p) => !created.some((c) => c.id === p.id))],
    [created, presets]
  )
  const matches = useMemo(
    () => searchLaborPresets(all, query, favorites, recent),
    [all, query, favorites, recent]
  )
  const results = matches.slice(0, 20)
  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [active, open, id])
  const packageSelected = selected && isLaborPackage(selected)
  const remember = (kind: 'favorites' | 'recent', values: string[]) => {
    if (kind === 'favorites') setFavorites(values)
    else setRecent(values)
    try {
      localStorage.setItem(`crm.labor.${kind}`, JSON.stringify(values))
    } catch {
      /* optional */
    }
  }
  const choose = (preset: LaborPresetOption) => {
    setSelected(preset)
    setQuery(preset.name)
    setOpen(false)
    setError('')
    if (!isLaborPackage(preset)) {
      const item = preset.items[0]
      setQuery(item.description)
      setQuantity(String(item.hours))
      setPrice(item.rate > 0 ? String(item.rate) : '')
      setPricingType(item.pricingType === 'service' ? 'service' : 'hourly')
      quantityRef.current?.focus()
      quantityRef.current?.select()
      requestAnimationFrame(() => {
        quantityRef.current?.focus()
        quantityRef.current?.select()
      })
    }
  }
  async function add(quickPreset?: LaborPresetOption) {
    if (locked || inFlight.current) return
    const preset = quickPreset ?? selected
    setError('')
    if (preset && isLaborPackage(preset)) {
      // Packages always require an explicit preview before committing parts and jobs.
      if (quickPreset) {
        choose(preset)
        return
      }
      onPackage(preset)
    } else {
      const item = quickPreset?.items[0]
      const hours = item ? item.hours : parseLaborNumber(quantity)
      const rate = item ? (item.rate > 0 ? item.rate : null) : parseLaborNumber(price)
      const description = (item?.description ?? query).trim()
      if (!description || hours === null || hours <= 0 || rate === null) {
        if (quickPreset) choose(quickPreset)
        setError(t('invalid'))
        return
      }
      const line: ServiceLaborInput = {
        description,
        hours,
        rate,
        total: lineTotal(hours, rate),
        pricingType: item ? (item.pricingType === 'service' ? 'service' : 'hourly') : pricingType,
      }
      if (!Number.isFinite(line.total)) {
        setError(t('invalid'))
        return
      }
      if (saveTypical && !preset && onSavePreset) {
        inFlight.current = true
        setSaving(true)
        try {
          const saved = await onSavePreset(line)
          setCreated((prev) => [saved, ...prev])
          setSelected(saved)
          setSaveTypical(false)
        } catch {
          setError(t('saveFailed'))
          return
        } finally {
          inFlight.current = false
          setSaving(false)
        }
      }
      if (lockedRef.current) return
      onAdd(line)
    }
    if (preset)
      remember('recent', [preset.id, ...recent.filter((v) => v !== preset.id)].slice(0, 20))
    setQuery('')
    setSelected(null)
    setQuantity('1')
    setPrice('')
    setPricingType('service')
    setSaveTypical(false)
    setOpen(false)
    setActive(0)
    setMessage(t('added'))
    searchRef.current?.focus()
    requestAnimationFrame(() => searchRef.current?.focus())
  }
  useEffect(() => {
    if (!query.trim()) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [query])
  return (
    <fieldset
      disabled={locked || saving}
      className="mb-4 min-w-0 rounded-lg border bg-muted/20 p-3"
      onInput={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (
          event.key !== 'Enter' ||
          event.nativeEvent.isComposing ||
          !(event.target instanceof HTMLInputElement) ||
          event.target.type === 'checkbox'
        )
          return
        event.preventDefault()
        event.stopPropagation()
        if (event.repeat) return
        if (event.target === searchRef.current && open && results.length) {
          if (event.ctrlKey || event.metaKey) void add(results[active])
          else choose(results[active])
        } else void add()
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <span className="font-medium">{t('title')}</span>
        <a
          className="text-sm underline min-h-11 inline-flex items-center"
          href="/labor-presets"
          target="_blank"
          rel="noreferrer"
        >
          {t('catalog')}
        </a>
      </div>
      <div className="grid grid-cols-2 gap-3 @[700px]:grid-cols-[minmax(0,1fr)_100px_130px_auto]">
        <div className="relative col-span-2 min-w-0 @[700px]:col-span-1">
          <label className="text-xs text-muted-foreground" htmlFor={`${id}-search`}>
            {t('search')}
          </label>
          <Input
            ref={searchRef}
            id={`${id}-search`}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={`${id}-list`}
            aria-activedescendant={open && results[active] ? `${id}-${active}` : undefined}
            autoComplete="off"
            className="min-h-11 text-base"
            placeholder={t('placeholder')}
            value={query}
            onFocus={() => {
              if (!selected) setOpen(true)
            }}
            onBlur={(event) => {
              if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node))
                setOpen(false)
            }}
            onChange={(event) => {
              setQuery(event.target.value)
              setSelected(null)
              setPrice('')
              setQuantity('1')
              setPricingType('service')
              setActive(0)
              setOpen(true)
              setError('')
              setMessage('')
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Tab') setOpen(false)
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                setOpen(false)
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                setOpen(true)
                setActive((v) =>
                  Math.max(
                    0,
                    Math.min(results.length - 1, v + (event.key === 'ArrowDown' ? 1 : -1))
                  )
                )
              }
            }}
          />
          {open && (
            <div className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-popover shadow-lg">
              <div id={`${id}-list`} role="listbox" aria-label={t('search')}>
                {results.map((p, index) => (
                  <div
                    key={p.id}
                    className={`flex items-center border-b ${index === active ? 'bg-accent' : ''}`}
                  >
                    <button
                      type="button"
                      id={`${id}-${index}`}
                      role="option"
                      aria-selected={index === active}
                      className="min-h-11 flex-1 min-w-0 p-2 text-left"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => choose(p)}
                    >
                      <span className="block break-words text-sm font-medium">{p.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {isLaborPackage(p)
                          ? t('package', { jobs: p.items.length, parts: p.parts?.length ?? 0 })
                          : p.items[0]?.pricingType === 'hourly'
                            ? t('hourly')
                            : t('service')}{' '}
                        ·{' '}
                        {p.items.some((i) => i.rate <= 0)
                          ? t('priceRequired')
                          : format(laborPresetTotal(p), currencyCode)}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="size-11 shrink-0 grid place-items-center"
                      aria-label={t('favorite', { name: p.name })}
                      aria-pressed={favorites.includes(p.id)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() =>
                        remember(
                          'favorites',
                          favorites.includes(p.id)
                            ? favorites.filter((v) => v !== p.id)
                            : [...favorites, p.id]
                        )
                      }
                    >
                      <Star
                        className={`size-4 ${favorites.includes(p.id) ? 'fill-amber-400 text-amber-400' : ''}`}
                      />
                    </button>
                  </div>
                ))}
              </div>
              {!results.length && <p className="p-2 text-sm">{t('empty')}</p>}
              {matches.length > 20 && <p className="p-2 text-xs">{t('narrow')}</p>}
              {query.trim() && (
                <button
                  type="button"
                  className="w-full min-h-11 p-2 text-left text-sm"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setSelected(null)
                    setOpen(false)
                    quantityRef.current?.focus()
                  }}
                >
                  {t('oneOff', { name: query })}
                </button>
              )}
            </div>
          )}
        </div>
        <label className="text-xs text-muted-foreground">
          {pricingType === 'hourly' ? t('hours') : t('quantity')}
          <Input
            ref={quantityRef}
            className="min-h-11 text-base"
            inputMode="decimal"
            value={quantity}
            disabled={!!packageSelected}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </label>
        <label className="text-xs text-muted-foreground">
          {pricingType === 'hourly' ? t('rate') : t('price')}
          <Input
            className="min-h-11 text-base"
            inputMode="decimal"
            placeholder={t('priceRequired')}
            value={price}
            disabled={!!packageSelected}
            onChange={(event) => setPrice(event.target.value)}
          />
        </label>
        <Button
          type="button"
          className="col-span-2 min-h-11 self-end @[700px]:col-span-1"
          onClick={() => void add()}
        >
          <Plus className="size-4" />
          {saving ? t('saving') : t('add')}
        </Button>
      </div>
      {packageSelected && selected && (
        <div className="mt-3 rounded border p-3 text-sm">
          <strong>{t('preview')}</strong>
          <ul className="mt-2 space-y-1">
            {selected.items.map((item, i) => (
              <li key={i}>
                {item.description} — {item.hours} × {format(item.rate, currencyCode)}
              </li>
            ))}
            {selected.parts?.map((part, i) => (
              <li key={`p${i}`}>
                {t('part')}: {part.name} — {part.quantity} × {format(part.unitPrice, currencyCode)}
              </li>
            ))}
          </ul>
          <p className="mt-2 font-semibold">{format(laborPresetTotal(selected), currencyCode)}</p>
        </div>
      )}
      {!selected && query.trim() && (
        <div className="mt-2 flex flex-wrap gap-3 items-center text-sm">
          <label>
            {t('type')}{' '}
            <select
              className="min-h-11 rounded border bg-background px-2"
              value={pricingType}
              onChange={(event) => setPricingType(event.target.value as 'service' | 'hourly')}
            >
              <option value="service">{t('service')}</option>
              <option value="hourly">{t('hourly')}</option>
            </select>
          </label>
          {onSavePreset && (
            <label className="inline-flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={saveTypical}
                onChange={(event) => setSaveTypical(event.target.checked)}
              />
              {t('saveTypical')}
            </label>
          )}
        </div>
      )}
      <p className="mt-2 hidden text-xs text-muted-foreground sm:block">{t('keys')}</p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <p role="status" className="text-sm text-muted-foreground">
        {message}
      </p>
    </fieldset>
  )
}
