'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, ChevronsUpDown } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandItem,
} from '@/components/ui/command'
import { getBrands } from '../Actions/brandActions'

let catalogue: ReturnType<typeof getBrands> | undefined
let fetchedAt = 0
function loadCatalogue() {
  if (!catalogue || Date.now() - fetchedAt > 60_000) {
    fetchedAt = Date.now()
    catalogue = getBrands()
      .then((result) => {
        if (!result.success) catalogue = undefined
        return result
      })
      .catch((error) => {
        catalogue = undefined
        throw error
      })
  }
  return catalogue
}

export function BrandCombobox({
  value,
  onChange,
  snapshot = false,
  id,
}: {
  value: string
  onChange: (value: string) => void
  snapshot?: boolean
  id?: string
}) {
  const t = useTranslations('inventory')
  const [open, setOpen] = useState(false)
  const [brands, setBrands] = useState<{ id: string; name: string; isActive: boolean }[]>([])
  useEffect(() => {
    let active = true
    loadCatalogue()
      .then((result) => {
        if (!active) return
        if (result.success && result.data) setBrands(result.data)
        else toast.error(result.error || t('form.brandLoadError'))
      })
      .catch(() => {
        if (active) toast.error(t('form.brandLoadError'))
      })
    return () => {
      active = false
    }
  }, [t])
  const selected = brands.find((b) => (snapshot ? b.name : b.id) === value)
  const label = snapshot ? value : selected?.name || (value === 'brand_unknown' ? '---' : '…')
  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-label={t('form.brand')}
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{label || '---'}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0">
        <Command>
          <CommandInput placeholder={t('form.brandSearch')} />
          <CommandList>
            <CommandEmpty>{t('form.brandNotFound')}</CommandEmpty>
            {brands
              .filter((b) => b.isActive)
              .map((b) => (
                <CommandItem
                  key={b.id}
                  value={b.name}
                  onSelect={() => {
                    onChange(snapshot ? b.name : b.id)
                    setOpen(false)
                  }}
                >
                  <Check
                    className={`mr-2 h-4 w-4 ${selected?.id === b.id ? 'opacity-100' : 'opacity-0'}`}
                  />
                  {b.name}
                </CommandItem>
              ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
