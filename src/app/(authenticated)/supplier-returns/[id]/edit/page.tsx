import { notFound, redirect } from 'next/navigation'
import { supplierReturnDetail, supplierReturnOptions } from '@/features/receipts/return-actions'
import { ConsolidatedReturnForm } from '@/features/receipts/ConsolidatedReturnForm'
import { DocumentHeader } from '@/components/operations/document-ui'
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params,
    r = await supplierReturnDetail(id)
  if (!r.success) return <p role="alert">{r.error}</p>
  if (!r.data) notFound()
  const d = r.data
  if (d.status !== 'draft') redirect('/supplier-returns/' + id)
  const options = await supplierReturnOptions(
    d.supplierId,
    d.lines.map((l) => l.lineId)
  )
  if (!options.data) return <p role="alert">{options.error}</p>
  return (
    <>
      <DocumentHeader
        title={'Редагування чернетки ' + d.number}
        back={{ href: '/supplier-returns/' + id, label: 'До документа' }}
      />
      <ConsolidatedReturnForm
        data={options.data}
        initial={{
          id,
          version: d.version,
          reason: d.reason,
          supplierDocumentNumber: d.supplierDocumentNumber,
          quantities: Object.fromEntries(d.lines.map((l) => [l.lineId, l.quantity])),
        }}
      />
    </>
  )
}
