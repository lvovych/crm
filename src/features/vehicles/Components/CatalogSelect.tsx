'use client'

import { useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { useTranslations } from 'next-intl'
import { catalogSearch } from '../Lib/vehicleCatalog'

export function CatalogSelect({
  id,
  label,
  value,
  options,
  onChange,
  disabled = false,
  allowCustom = false,
}: {
  id: string
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
  disabled?: boolean
  allowCustom?: boolean
}) {
  const t = useTranslations('workOrders.vehiclePicker')
  const [open, setOpen] = useState(false)
  const [manual, setManual] = useState(false)
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {manual ? (
        <>
          <Input
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            maxLength={150}
            disabled={disabled}
            className="min-h-11 text-base"
            autoComplete="off"
          />
          <Button
            type="button"
            variant="link"
            className="min-h-11 h-auto p-0"
            onClick={() => {
              setManual(false)
              onChange('')
            }}
          >
            {t('catalog.backToList')}
          </Button>
        </>
      ) : (
        <Popover open={open} onOpenChange={setOpen} modal>
          <PopoverTrigger asChild>
            <Button
              id={id}
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              disabled={disabled}
              className="min-h-11 w-full min-w-0 justify-between font-normal text-base"
            >
              <span className="truncate">{value || t('catalog.choose')}</span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-(--radix-popover-trigger-width) max-w-[calc(100vw-2rem)] p-0"
          >
            <Command
              label={t('catalog.searchField', { field: label })}
              filter={(item, search) =>
                catalogSearch(item).includes(catalogSearch(search)) ? 1 : 0
              }
            >
              <CommandInput
                placeholder={t('catalog.search')}
                aria-label={t('catalog.searchField', { field: label })}
                className="min-h-11 text-base"
              />
              <CommandList className="max-h-[min(16rem,40dvh)] overscroll-contain">
                <CommandEmpty>{t('catalog.empty')}</CommandEmpty>
                <CommandGroup>
                  {options.map((option) => (
                    <CommandItem
                      key={option}
                      value={option}
                      className="min-h-11 whitespace-normal break-words"
                      onSelect={() => {
                        onChange(option)
                        setOpen(false)
                      }}
                    >
                      <Check
                        className={`mr-2 h-4 w-4 shrink-0 ${value === option ? 'opacity-100' : 'opacity-0'}`}
                      />
                      {option}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
            {allowCustom && (
              <div className="border-t p-1">
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11 w-full whitespace-normal"
                  onClick={() => {
                    setOpen(false)
                    setManual(true)
                    onChange('')
                  }}
                >
                  {t('catalog.notListed')}
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
