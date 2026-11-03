import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { getSupplierCapabilities } from '@/features/suppliers/Actions/supplierActions'
import { SupplierImportPreview } from '@/features/suppliers/Components/SupplierImportPreview'
export default async function ImportPage() {
  const [cap, t] = await Promise.all([getSupplierCapabilities(), getTranslations('suppliers')])
  return (
    <>
      <PageHeader />
      <main className="space-y-5 p-6">
        <h1 className="text-2xl font-semibold">{t('importTitle')}</h1>
        {cap.data?.import ? <SupplierImportPreview /> : <p role="alert">{t('readOnly')}</p>}
      </main>
    </>
  )
}
