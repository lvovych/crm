import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { SupplierEditor } from '@/features/suppliers/Components/SupplierEditor'
import { getSupplierCapabilities } from '@/features/suppliers/Actions/supplierActions'
export default async function NewSupplierPage() {
  const [cap, t] = await Promise.all([getSupplierCapabilities(), getTranslations('suppliers')])
  return (
    <>
      <PageHeader />
      <main className="p-6">
        <h1 className="mb-6 text-2xl font-semibold">{t('new')}</h1>
        {cap.data?.create ? <SupplierEditor /> : <p role="alert">{t('readOnly')}</p>}
      </main>
    </>
  )
}
