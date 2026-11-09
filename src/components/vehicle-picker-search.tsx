'use client'

import { useId, useMemo, useRef, type KeyboardEvent } from 'react'
import { useTranslations } from 'next-intl'
import { ArrowRight, Car, Plus, Search, Ship, ShoppingCart, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  matchesVehiclePickerSearch,
  vehiclePickerMatchFields,
  type VehiclePickerOption,
} from '@/features/vehicles/Lib/vehiclePickerSearch'

function Match({ value, matched }: { value: string; matched: boolean }) {
  return matched ? (
    <mark className="rounded bg-primary/20 px-0.5 text-foreground">{value}</mark>
  ) : (
    <>{value}</>
  )
}

export function VehiclePickerSearch({
  compact = false,
  vehicles,
  query,
  onQueryChange,
  onSelect,
  onCreate,
  onSale,
  isMarine,
}: {
  compact?: boolean
  vehicles: VehiclePickerOption[]
  query: string
  onQueryChange: (value: string) => void
  onSelect: (id: string) => void
  onCreate: () => void
  onSale?: () => void
  isMarine: boolean
}) {
  const t = useTranslations('workOrders.vehiclePicker')
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const results = useRef<HTMLDivElement>(null)
  const filtered = useMemo(
    () => vehicles.filter((v) => matchesVehiclePickerSearch(v, query)),
    [vehicles, query]
  )
  const focusResult = (index: number) => {
    const buttons = results.current?.querySelectorAll<HTMLButtonElement>('[data-vehicle-result]')
    const button = buttons?.[index]
    button?.focus()
    button?.scrollIntoView?.({ block: 'nearest' })
  }
  const clear = () => {
    onQueryChange('')
    input.current?.focus()
  }
  const navigate = (event: KeyboardEvent, index?: number) => {
    if (event.nativeEvent.isComposing || !filtered.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusResult(index === undefined ? 0 : Math.min(index + 1, filtered.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (index === 0) input.current?.focus()
      else focusResult(index === undefined ? filtered.length - 1 : index - 1)
    } else if (event.key === 'Enter' && index === undefined) {
      event.preventDefault()
      if (filtered.length === 1) onSelect(filtered[0].id)
      else focusResult(0)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="shrink-0 space-y-2">
        <Label htmlFor={id} className="text-sm font-medium">
          {isMarine ? t('searchLabelMarine') : t('searchLabel')}
        </Label>
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={input}
            id={id}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => navigate(e)}
            aria-describedby={`${id}-help`}
            aria-controls={`${id}-results`}
            placeholder={isMarine ? t('searchExampleMarine') : t('searchExample')}
            className="h-12 pl-10 pr-12 text-base"
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="go"
          />
          {query && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-0.5 top-0.5 size-11"
              aria-label={t('clearSearch')}
              onClick={clear}
            >
              <X aria-hidden className="size-5" />
            </Button>
          )}
        </div>
        <p
          id={`${id}-help`}
          className={`text-xs leading-5 text-muted-foreground ${compact ? 'max-sm:sr-only' : ''}`}
        >
          {isMarine ? t('searchHelpMarine') : t('searchHelp')}
        </p>
      </div>
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="shrink-0 text-sm font-medium"
      >
        {t('resultCount', { count: filtered.length })}
      </p>
      <div
        ref={results}
        id={`${id}-results`}
        role="region"
        aria-label={t('searchResults')}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 sm:max-h-[420px]"
      >
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-muted/20 px-4 py-5 text-center">
            <p className="font-medium">
              {vehicles.length === 0
                ? isMarine
                  ? t('emptyMarine')
                  : t('empty')
                : t('noSearchResults')}
            </p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('emptySearchHelp')}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((v, index) => {
              const match = vehiclePickerMatchFields(v, query)
              const Icon = isMarine ? Ship : Car
              return (
                <li key={v.id}>
                  <button
                    type="button"
                    data-vehicle-result
                    className="flex min-h-24 w-full items-start gap-3 rounded-xl border border-border bg-muted/20 p-3 text-left transition-colors hover:border-primary/60 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                    onKeyDown={(e) => navigate(e, index)}
                    onClick={() => onSelect(v.id)}
                  >
                    <Icon
                      aria-hidden
                      className="mt-1 hidden size-5 shrink-0 text-muted-foreground sm:block"
                    />
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                        <span className="font-semibold tabular-nums">
                          <Match
                            value={v.licensePlate || (isMarine ? t('noPlateMarine') : t('noPlate'))}
                            matched={match.plate}
                          />
                        </span>
                        <span className="break-words font-medium">
                          <Match value={`${v.make} ${v.model}`} matched={match.vehicle} />
                        </span>
                      </span>
                      <span className="block break-words text-sm text-muted-foreground">
                        <Match value={String(v.year)} matched={match.year} />
                        {v.customer?.name && (
                          <>
                            {' '}
                            · <Match value={v.customer.name} matched={match.owner} />
                          </>
                        )}
                      </span>
                      {v.customer?.phone && (
                        <span className="block break-words text-sm tabular-nums">
                          <Match value={v.customer.phone} matched={match.phone} />
                        </span>
                      )}
                      {v.vin && match.vin && (
                        <span className="block break-all text-xs text-muted-foreground">
                          VIN: <Match value={v.vin} matched />
                        </span>
                      )}
                    </span>
                    <ArrowRight
                      aria-hidden
                      className="mt-1 size-4 shrink-0 text-muted-foreground"
                    />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {onSale && (
          <div className="mt-4 border-t pt-3">
            <Button
              type="button"
              variant="ghost"
              className="h-auto min-h-11 w-full whitespace-normal"
              onClick={onSale}
            >
              <ShoppingCart aria-hidden />
              {t('partsSale')}
            </Button>
          </div>
        )}
      </div>
      <div className="shrink-0 border-t pt-3">
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-12 w-full whitespace-normal"
          onClick={onCreate}
        >
          <Plus aria-hidden />
          {isMarine ? t('addNewVehicleMarine') : t('addVehicleShort')}
        </Button>
        <p className="mt-2 hidden text-center text-xs text-muted-foreground sm:block">
          {t('keyboardHelp')}
        </p>
      </div>
    </div>
  )
}
