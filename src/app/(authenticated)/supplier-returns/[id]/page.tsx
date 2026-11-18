import { notFound } from 'next/navigation'
import { supplierReturnDetail } from '@/features/receipts/return-actions'
import { SupplierReturnDocument } from '@/features/receipts/SupplierReturnDocument'
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await supplierReturnDetail(id)
  if (!r.success) return <p role="alert">{r.error}</p>
  if (!r.data) notFound()
  return <SupplierReturnDocument document={r.data} />
}
