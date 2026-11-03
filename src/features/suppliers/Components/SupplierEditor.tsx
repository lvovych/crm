'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { saveSupplier } from '../Actions/supplierActions'
import { supplierSchema, type SupplierInput } from '../Schema/supplierSchema'
export function SupplierEditor({
  initial,
  id,
  updatedAt,
}: {
  initial?: SupplierInput
  id?: string
  updatedAt?: string
}) {
  const t = useTranslations('suppliers'),
    router = useRouter()
  const [data, setData] = useState<SupplierInput>(
    () => initial ?? { ...supplierSchema.parse({ name: 'New' }), name: '' }
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = (
    key:
      | 'name'
      | 'legalName'
      | 'country'
      | 'taxId'
      | 'address'
      | 'website'
      | 'notes'
      | 'paymentTerms'
  ) => (
    <label className="grid gap-1 text-sm" key={key}>
      {t(key)}
      <Input
        required={key === 'name'}
        value={data[key]}
        onChange={(e) => setData({ ...data, [key]: e.target.value })}
      />
    </label>
  )
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await saveSupplier(data, id, updatedAt)
      if (!res.success || !res.data) {
        setError(res.error ?? t('error'))
        return
      }
      toast.success(t('saved'))
      router.push('/suppliers/' + res.data.id)
      router.refresh()
    } catch {
      setError(t('error'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="max-w-4xl space-y-6">
      <fieldset disabled={busy} className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              'name',
              'legalName',
              'country',
              'taxId',
              'address',
              'website',
              'notes',
              'paymentTerms',
            ] as const
          ).map(input)}
          <label className="grid gap-1 text-sm">
            {t('kind')}
            <select
              className="rounded border bg-background p-2"
              value={data.kind}
              onChange={(e) => setData({ ...data, kind: e.target.value as SupplierInput['kind'] })}
            >
              {['unknown', 'company', 'entrepreneur', 'person'].map((v) => (
                <option key={v} value={v}>
                  {t(v)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            {t('paymentTermDays')}
            <Input
              type="number"
              min="0"
              max="3650"
              value={data.paymentTermDays ?? ''}
              onChange={(e) =>
                setData({
                  ...data,
                  paymentTermDays: e.target.value === '' ? null : Number(e.target.value),
                })
              }
            />
          </label>
        </div>
        <section className="space-y-3">
          <h2 className="font-semibold">{t('contacts')}</h2>
          {data.contacts.map((c, i) => (
            <div key={i} className="grid gap-3 rounded border p-3 sm:grid-cols-2">
              {(['name', 'role', 'phone', 'email'] as const).map((k) => (
                <label key={k} className="text-sm">
                  {t(k === 'name' ? 'contactName' : k)}
                  <Input
                    type={k === 'email' ? 'email' : 'text'}
                    value={c[k]}
                    onChange={(e) =>
                      setData({
                        ...data,
                        contacts: data.contacts.map((v, j) =>
                          i === j ? { ...v, [k]: e.target.value } : v
                        ),
                      })
                    }
                  />
                </label>
              ))}
              <label>
                <input
                  type="checkbox"
                  checked={c.isPrimary}
                  onChange={(e) =>
                    setData({
                      ...data,
                      contacts: data.contacts.map((v, j) => ({
                        ...v,
                        isPrimary: i === j ? e.target.checked : false,
                      })),
                    })
                  }
                />{' '}
                {t('primary')}
              </label>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setData({ ...data, contacts: data.contacts.filter((_, j) => j !== i) })
                }
              >
                {t('remove')}
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setData({
                ...data,
                contacts: [
                  ...data.contacts,
                  { name: '', role: '', phone: '', email: '', isPrimary: !data.contacts.length },
                ],
              })
            }
          >
            {t('addContact')}
          </Button>
        </section>
        <section className="space-y-3">
          <h2 className="font-semibold">{t('bankAccounts')}</h2>
          {data.bankAccounts.map((c, i) => (
            <div key={i} className="grid gap-3 rounded border p-3 sm:grid-cols-2">
              {(['accountNumber', 'bankName', 'currency'] as const).map((k) => (
                <label key={k} className="text-sm">
                  {t(k)}
                  <Input
                    value={c[k]}
                    onChange={(e) =>
                      setData({
                        ...data,
                        bankAccounts: data.bankAccounts.map((v, j) =>
                          i === j ? { ...v, [k]: e.target.value } : v
                        ),
                      })
                    }
                  />
                </label>
              ))}
              <label>
                <input
                  type="checkbox"
                  checked={c.isPrimary}
                  onChange={(e) =>
                    setData({
                      ...data,
                      bankAccounts: data.bankAccounts.map((v, j) => ({
                        ...v,
                        isPrimary: i === j ? e.target.checked : false,
                      })),
                    })
                  }
                />{' '}
                {t('primary')}
              </label>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setData({ ...data, bankAccounts: data.bankAccounts.filter((_, j) => j !== i) })
                }
              >
                {t('remove')}
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setData({
                ...data,
                bankAccounts: [
                  ...data.bankAccounts,
                  {
                    accountNumber: '',
                    bankName: '',
                    currency: 'UAH',
                    isPrimary: !data.bankAccounts.length,
                  },
                ],
              })
            }
          >
            {t('addBank')}
          </Button>
        </section>
      </fieldset>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <Button disabled={busy}>{t('save')}</Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(id ? '/suppliers/' + id : '/suppliers')}
        >
          {t('cancel')}
        </Button>
      </div>
    </form>
  )
}
