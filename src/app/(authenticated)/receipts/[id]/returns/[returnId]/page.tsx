import Link from 'next/link'
import { notFound } from 'next/navigation'
import { supplierReturnData } from '@/features/receipts/return-actions'

export default async function Page({
  params,
}: {
  params: Promise<{ id: string; returnId: string }>
}) {
  const { id, returnId } = await params
  const result = await supplierReturnData(id)
  if (!result.data) return <p role="alert">{result.error}</p>
  const document = result.data.documents.find((d) => d.id === returnId)
  if (!document) notFound()
  return (
    <div className="space-y-6">
      <Link href={'/receipts/' + id} className="underline">
        ← До прихідної накладної
      </Link>
      <section className="rounded-xl border-2 p-6 space-y-4">
        <h1 className="text-2xl font-semibold">Повернення постачальнику № {document.number}</h1>
        <p className="font-semibold">
          {result.data.supplier} · {document.date} · Проведено
        </p>
        <p>{document.reason}</p>
        <table className="w-full text-left">
          <thead className="bg-muted">
            <tr>
              <th className="p-3">Позиція</th>
              <th>Кількість</th>
              <th>Сума повернення</th>
            </tr>
          </thead>
          <tbody>
            {document.lines.map((line, index) => (
              <tr className="border-b" key={index}>
                <td className="p-3">{line.name}</td>
                <td>
                  {line.quantity} {line.unit}
                </td>
                <td>{line.amount} грн</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xl font-semibold">
          Разом{' '}
          {document.lines.reduce((sum, line) => sum + Math.round(Number(line.amount) * 100), 0) /
            100}{' '}
          грн
        </p>
      </section>
    </div>
  )
}
