import { randomUUID } from 'node:crypto'
import { receiptOptions } from '@/features/receipts/actions'
import ReceiptForm from '@/features/receipts/ReceiptForm'
export default async function Page() {
  const r = await receiptOptions()
  if (!r.data) return <p role="alert">{r.error}</p>
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  return (
    <>
      <h1 className="text-2xl font-semibold">Нова накладна</h1>
      <ReceiptForm
        options={r.data}
        initial={{
          id: randomUUID(),
          version: 0,
          supplierId: '',
          number: '',
          documentDate: day,
          receivedDate: day,
          lines: [
            { kind: 'part', partId: null, name: '', unit: 'шт', quantity: '1', unitPrice: '0' },
          ],
        }}
      />
    </>
  )
}
