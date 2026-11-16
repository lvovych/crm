import { mutualSettlementsReport } from './actions'
import { SettlementDocument } from './OverviewClient'
import { dayLabel } from '@/features/finance/presentation'

export async function PartyDocuments({ kind, id, date }: {
  kind: 'supplier' | 'customer'; id: string; date?: string
}) {
  const result = await mutualSettlementsReport(date, { kind, id })
  if (!result.data) return null
  const { parties, trackedParties, asOf, supplierError } = result.data
  const documents = [...(trackedParties ?? []), ...parties]
    .filter(p => p.kind === kind && p.id === id)
    .flatMap(p => p.documents)
  return (
    <section id="settlement-documents" className="space-y-3">
      <h2 className="text-lg font-semibold">Документи взаєморозрахунків</h2>
      <p className="text-sm text-muted-foreground">Станом на {dayLabel(asOf)}</p>
      {supplierError ? <p role="alert">{supplierError}</p> : documents.length
        ? documents.map(d => <SettlementDocument key={d.id} row={d} />)
        : <p>Документів на цю дату немає.</p>}
    </section>
  )
}
