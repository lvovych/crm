'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { searchReturnSuppliers } from './return-actions'

export function ReturnSupplierFilter({ initialId = '' }: { initialId?: string }) {
  const [value, setValue] = useState(initialId)
  const [label, setLabel] = useState(initialId ? 'Обраний постачальник' : 'Усі постачальники')
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [items, setItems] = useState<{ id: string; name: string }[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!open && !value) return
    let active = true
    setLoading(true)
    setError('')
    const timer = setTimeout(() => {
      void searchReturnSuppliers(q, value)
        .then((result) => {
          if (!active) return
          if (!result.data) throw new Error('Search failed')
          setItems(result.data.items)
          if (result.data.selected) setLabel(result.data.selected.name)
        })
        .catch(() => {
          if (active) setError('Не вдалося завантажити постачальників.')
        })
        .finally(() => {
          if (active) setLoading(false)
        })
    }, 200)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [open, q, value])
  function choose(id: string, name: string) {
    setValue(id)
    setLabel(name)
    setOpen(false)
  }
  return (
    <div className="grid gap-2">
      <span>Постачальник</span>
      <input type="hidden" name="supplier" value={value} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" aria-label={'Постачальник: ' + label}>
            {label}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 space-y-2">
          <Input
            aria-label="Пошук постачальника"
            value={q}
            maxLength={120}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.preventDefault()
            }}
          />
          <Button type="button" variant="ghost" onClick={() => choose('', 'Усі постачальники')}>
            Усі постачальники
          </Button>
          {loading ? (
            <p role="status">Пошук…</p>
          ) : error ? (
            <p role="alert">{error}</p>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              {items.map((s) => (
                <Button
                  className="w-full justify-start"
                  key={s.id}
                  type="button"
                  variant="ghost"
                  onClick={() => choose(s.id, s.name)}
                >
                  {s.name}
                </Button>
              ))}
              {!items.length && <p role="status">Постачальників не знайдено.</p>}
              {items.length === 20 && (
                <p className="text-sm text-muted-foreground">Уточніть назву, щоб звузити пошук.</p>
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}
