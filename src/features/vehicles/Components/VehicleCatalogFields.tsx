'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import makes from '../../../../public/vehicle-catalog/index.json'
import { CatalogSelect } from './CatalogSelect'
import type { CatalogMake } from '../Lib/vehicleCatalog'
import { Button } from '@/components/ui/button'

export interface VehicleIdentity {
  make: string
  model: string
  generation: string
  modification: string
  engineSize: string
}
export const EMPTY_VEHICLE_IDENTITY: VehicleIdentity = {
  make: '',
  model: '',
  generation: '',
  modification: '',
  engineSize: '',
}

export function VehicleCatalogFields({
  value,
  onChange,
}: {
  value: VehicleIdentity
  onChange: (value: VehicleIdentity) => void
}) {
  const t = useTranslations('workOrders.vehiclePicker')
  const [catalog, setCatalog] = useState<{ id: string; data: CatalogMake } | null>(null)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const makeId = makes.find((m) => m.name === value.make)?.id
  const data = catalog?.id === makeId ? catalog?.data : undefined
  useEffect(() => {
    setError(false)
    if (!makeId) return
    const controller = new AbortController()
    fetch(`/vehicle-catalog/${makeId}.json`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Catalogue unavailable')
        return response.json()
      })
      .then((data) => {
        if (!controller.signal.aborted) setCatalog({ id: makeId, data })
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true)
      })
    return () => controller.abort()
  }, [makeId, retry])
  const model = data?.models.find((m) => m.name === value.model)
  const generation = model?.generations.find((g) => g.name === value.generation)
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <CatalogSelect
          id="new-make"
          label={t('make')}
          value={value.make}
          options={makes.map((m) => m.name)}
          allowCustom
          onChange={(make) => onChange({ ...EMPTY_VEHICLE_IDENTITY, make })}
        />
        <CatalogSelect
          key={value.make}
          id="new-model"
          label={t('model')}
          value={value.model}
          options={[...new Set(data?.models.map((m) => m.name) ?? [])]}
          disabled={!value.make.trim()}
          allowCustom
          onChange={(model) =>
            onChange({ ...value, model, generation: '', modification: '', engineSize: '' })
          }
        />
      </div>
      {makeId && !data && !error && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('catalog.loading')}
        </p>
      )}
      {error && (
        <div role="alert" className="text-sm">
          {t('catalog.loadError')}{' '}
          <Button type="button" variant="link" onClick={() => setRetry((n) => n + 1)}>
            {t('catalog.retry')}
          </Button>
        </div>
      )}
      {!!model?.generations.length && (
        <>
          <CatalogSelect
            key={`${value.make}/${value.model}`}
            id="new-generation"
            label={t('catalog.generation')}
            value={value.generation}
            options={[...new Set(model.generations.map((g) => g.name))]}
            onChange={(generation) =>
              onChange({ ...value, generation, modification: '', engineSize: '' })
            }
          />
          {!!generation?.engines.length && (
            <CatalogSelect
              key={value.generation}
              id="new-modification"
              label={t('catalog.modification')}
              value={value.modification}
              options={generation.engines.map((e) => e.name)}
              onChange={(modification) => {
                const engine = generation.engines.find((e) => e.name === modification)
                onChange({
                  ...value,
                  modification,
                  engineSize: engine?.displacementCc ? String(engine.displacementCc / 1000) : '',
                })
              }}
            />
          )}
          {value.generation && (
            <Button
              type="button"
              variant="link"
              className="min-h-11 h-auto p-0"
              onClick={() =>
                onChange({ ...value, generation: '', modification: '', engineSize: '' })
              }
            >
              {t('catalog.clearDetails')}
            </Button>
          )}
        </>
      )}
      <p className="text-xs text-muted-foreground">
        {t('catalog.coverage')}{' '}
        <a href="/vehicle-catalog/README.md" target="_blank" rel="noreferrer" className="underline">
          {t('catalog.source')}
        </a>
      </p>
    </div>
  )
}
