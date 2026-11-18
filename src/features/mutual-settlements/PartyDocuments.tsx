import { getOperationText } from '@/i18n/operation-text.server'
import { mutualSettlementsReport } from './actions'
import { SettlementDocument } from './OverviewClient'
import { dayLabel, moneyLabel } from '@/features/finance/presentation'

export async function PartyDocuments({
  kind,
  id,
  date,
}: {
  kind: 'supplier' | 'customer'
  id: string
  date?: string
}) {
  const ot = await getOperationText()

  const result = await mutualSettlementsReport(date, { kind, id })
  if (!result.data) return null
  const { parties, trackedParties, asOf, supplierError } = result.data
  const documents = [...(trackedParties ?? []), ...parties]
    .filter((p) => p.kind === kind && p.id === id)
    .flatMap((p) => p.documents)
  return (
    <section id="settlement-documents" className="ops-workspace space-y-3">
      <h2 className="text-lg font-semibold">{ot('Документи взаєморозрахунків')}</h2>
      <p className="text-sm text-muted-foreground">
        {ot("Станом на ")}
        {dayLabel(asOf)}
      </p>
      {supplierError ? (
        <p role="alert">{supplierError}</p>
      ) : documents.length ? (
        <div className="divide-y rounded-xl border bg-card">
          {documents.map((d) => (
            <details key={d.id} className="px-4 py-1">
              <summary className="py-3">
                <span className="inline-grid w-[calc(100%-1rem)] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 align-top">
                  <span className="min-w-0 break-words">
                    {d.label}
                    <span className="mt-1 block text-xs font-normal text-muted-foreground">
                      {d.date ? dayLabel(d.date) : ot('Дата уточнюється')}
                      {d.reason ? ot(" · Не включено до підсумків") : ''}
                    </span>
                  </span>
                  <span className="text-right tabular-nums">
                    <span className="block text-xs font-normal text-muted-foreground">
                      {ot('Сума')}
                    </span>
                    {d.amount === null ? ot('Не визначено') : moneyLabel(d.amount, ot('грн'))}
                  </span>
                </span>
              </summary>
              <div className="pb-4">
                <SettlementDocument row={d} />
              </div>
            </details>
          ))}
        </div>
      ) : (
        <p>{ot('Документів на цю дату немає.')}</p>
      )}
    </section>
  )
}
