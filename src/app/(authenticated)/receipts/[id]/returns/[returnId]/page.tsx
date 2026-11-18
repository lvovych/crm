import { notFound } from 'next/navigation'
import { supplierReturnDetail } from '@/features/receipts/return-actions'
import { SupplierReturnDocument } from '@/features/receipts/SupplierReturnDocument'
export default async function Page({
  params,
}: {
  params: Promise<{ id: string; returnId: string }>
}) {
  const { id, returnId } = await params
  const r = await supplierReturnDetail(returnId)
  if (!r.success) return <p role="alert">{r.error}</p>
  if (!r.data || !r.data.lines.some((l) => l.receiptId === id)) notFound()
  return <SupplierReturnDocument document={r.data} />
}
