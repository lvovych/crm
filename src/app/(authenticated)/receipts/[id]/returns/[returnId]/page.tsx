import { DocumentHeader, DocumentStatus, MoneySummary } from '@/components/operations/document-ui'
import { dayLabel, moneyLabel } from '@/features/finance/presentation'
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
      <DocumentHeader
        title={'Повернення постачальнику № ' + document.number}
        back={{ href: '/receipts/' + id + '?tab=returns', label: 'До прихідної накладної' }}
        status={<DocumentStatus tone="success">Проведено</DocumentStatus>}
        description={result.data.supplier + ' · ' + dayLabel(document.date)}
      />
      <MoneySummary
        items={[
          {
            label: 'Сума повернення',
            value: (
              document.lines.reduce((sum, line) => sum + Math.round(Number(line.amount) * 100), 0) /
              100
            ).toFixed(2),
            emphasis: true,
          },
        ]}
      />
      <section className="ops-panel space-y-4">
        <div>
          <h2 className="text-sm font-medium text-muted-foreground">Причина повернення</h2>
          <p className="mt-1">{document.reason}</p>
        </div>
        <div className="ops-table-scroll">
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
                  <td className="text-right font-semibold">{moneyLabel(line.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
