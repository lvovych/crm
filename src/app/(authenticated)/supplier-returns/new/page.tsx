import { supplierReturnOptions } from '@/features/receipts/return-actions'
import { ConsolidatedReturnForm } from '@/features/receipts/ConsolidatedReturnForm'
import { DocumentHeader } from '@/components/operations/document-ui'
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ supplier?: string }>
}) {
  const { supplier } = await searchParams
  if (!supplier)
    return <p>Відкрийте картку постачальника та натисніть «Повернення постачальнику».</p>
  const r = await supplierReturnOptions(supplier)
  if (!r.data) return <p role="alert">{r.error}</p>
  return (
    <>
      <DocumentHeader
        title="Нове повернення постачальнику"
        back={{ href: '/suppliers/' + supplier, label: r.data.supplier }}
        description={r.data.supplier}
      />
      <ConsolidatedReturnForm data={r.data} />
    </>
  )
}
