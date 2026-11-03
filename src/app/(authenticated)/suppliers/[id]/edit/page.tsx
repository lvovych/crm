import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { getSupplier, getSupplierCapabilities } from '@/features/suppliers/Actions/supplierActions'
import { SupplierEditor } from '@/features/suppliers/Components/SupplierEditor'
import { supplierSchema } from '@/features/suppliers/Schema/supplierSchema'
export default async function EditSupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [r, cap, t] = await Promise.all([
    getSupplier(id),
    getSupplierCapabilities(),
    getTranslations('suppliers'),
  ])
  const s = r.data?.supplier
  if (!s || !cap.data?.update)
    return (
      <>
        <PageHeader />
        <p role="alert" className="p-6">
          {r.error ?? t('readOnly')}
        </p>
      </>
    )
  const nullable = (v: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(v).map(([k, v]) => [k, v === null ? '' : v]))
  const initial = supplierSchema.parse({
    ...nullable(s),
    ...nullable(s.supplierProfile ?? {}),
    paymentTermDays: s.supplierProfile?.paymentTermDays ?? null,
    contacts: s.contacts.map(nullable),
    bankAccounts: s.bankAccounts.map(nullable),
  })
  return (
    <>
      <PageHeader />
      <main className="p-6">
        <h1 className="mb-6 text-2xl font-semibold">{t('edit')}</h1>
        <SupplierEditor id={id} initial={initial} updatedAt={s.updatedAt.toISOString()} />
      </main>
    </>
  )
}
