'use client'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { listSuppliers, getSupplier, supplierDirectoryAvailable } from '../Actions/supplierActions'
export function SupplierPicker({
  value,
  onChange,
}: {
  value: string | null
  onChange: (value: string | null) => void
}) {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    void supplierDirectoryAvailable().then((r) => setEnabled(r.data === true))
  }, [])
  const t = useTranslations('suppliers')
  const [search, setSearch] = useState(''),
    [items, setItems] = useState<
      {
        id: string
        name: string
        contacts: { phone: string | null; email: string | null; isPrimary: boolean }[]
      }[]
    >([]),
    [current, setCurrent] = useState(''),
    [open, setOpen] = useState(false),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false)
  useEffect(() => {
    let live = true
    if (!enabled || !value) {
      setCurrent('')
      return
    }
    void getSupplier(value).then((r) => {
      if (live && r.data)
        setCurrent(
          r.data.supplier.name + (r.data.supplier.isArchived ? ' (' + t('archived') + ')' : '')
        )
    })
    return () => {
      live = false
    }
  }, [value, t, enabled])
  useEffect(() => {
    if (!open) return
    let live = true
    setLoading(true)
    setItems([])
    const timer = setTimeout(() => {
      void listSuppliers({ search })
        .then((r) => {
          if (!live) return
          if (r.data) {
            setItems(r.data.items)
            setError('')
          } else setError(r.error ?? t('error'))
          setLoading(false)
        })
        .catch(() => {
          if (live) {
            setError(t('error'))
            setLoading(false)
          }
        })
    }, 200)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [search, open, t])
  if (!enabled) return null
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t('preferred')}</p>
      <p className="text-sm">{current || (value ? t('current') : t('none'))}</p>
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={() => setOpen(!open)}>
          {t('choose')}
        </Button>
        {value && (
          <Button type="button" variant="outline" onClick={() => onChange(null)}>
            {t('remove')}
          </Button>
        )}
      </div>
      {open && (
        <div className="rounded border p-3">
          <Input
            aria-label={t('choose')}
            placeholder={t('search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {error && <p role="alert">{error}</p>}
          <ul className="max-h-48 overflow-auto">
            {items.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="w-full p-2 text-left hover:bg-muted"
                  onClick={() => {
                    onChange(s.id)
                    setCurrent(s.name)
                    setOpen(false)
                  }}
                >
                  {s.name}
                  <span className="block text-xs text-muted-foreground">
                    {(() => {
                      const c = s.contacts.find((c) => c.isPrimary) ?? s.contacts[0]
                      return [c?.phone, c?.email].filter(Boolean).join(' · ')
                    })()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {loading && <p role="status">{t('loading')}</p>}
          {!loading && !items.length && !error && <p>{t('empty')}</p>}
        </div>
      )}
    </div>
  )
}
