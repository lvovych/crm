import { cents, decimal } from '@/features/finance/money'
import type { PartyRow, DocumentRow } from '@/features/mutual-settlements/types'
export type LedgerEvent = {
  id: string
  kind: string
  date: string
  recordedAt: string
  chargeDelta: string
  paidDelta: string
  amount: string | null
  status: string | null
  due: string | null
  manualPaid: boolean | null
  paymentId: string | null
  sourceDate: string | null
  actor: string | null
  note: string | null
}
export type LedgerDocument = {
  id: string
  customerId: string | null
  customerName: string | null
  vehicleId: string | null
  label: string
  events: LedgerEvent[]
}
export function projectLedger(
  documents: LedgerDocument[],
  customers: Map<string, { name: string; phone: string | null }>,
  asOf: string
): PartyRow[] {
  const parties = new Map<string, PartyRow>()
  for (const d of documents) {
    const events = d.events
      .filter((e) => e.date <= asOf)
      .sort((a, b) => a.date.localeCompare(b.date) || (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
    const state = events.filter((e) => e.status !== null).at(-1)
    if (!state || state.status === 'deleted') continue
    const charge = events.reduce((s, e) => s + cents(e.chargeDelta), BigInt(0)),
      paid = events.reduce((s, e) => s + cents(e.paidDelta), BigInt(0))
    const reason = !d.customerId ? 'Клієнт не визначений. Потрібно вказати клієнта в наряді.' : null
    const completed = state.status === 'completed',
      cancelled = ['cancelled', 'canceled'].includes(state.status!)
    const open = charge - paid
    const row: DocumentRow = {
      id: d.id,
      label: d.label,
      href: d.vehicleId ? `/vehicles/${d.vehicleId}/service/${d.id}` : `/sales/${d.id}`,
      date: events[0].date,
      due: state.due,
      amount: state.amount,
      paid: decimal(paid),
      debt: decimal(!reason && open > 0 ? open : BigInt(0)),
      advance: decimal(!reason && open < 0 ? -open : BigInt(0)),
      expected: !reason && !completed && !cancelled ? (state.amount ?? '0.00') : '0.00',
      reason,
      provisional: false,
      history: events,
    }
    const key = d.customerId ?? 'unassigned',
      customer = d.customerId ? customers.get(d.customerId) : null
    let p = parties.get(key)
    if (!p) {
      p = {
        id: key,
        name: customer?.name ?? d.customerName ?? 'Клієнт не визначений',
        phone: customer?.phone ?? '',
        kind: 'customer',
        archived: false,
        debt: '0.00',
        advance: '0.00',
        overdue: '0.00',
        expected: '0.00',
        documents: [],
      }
      parties.set(key, p)
    }
    p.documents.push(row)
    for (const field of ['debt', 'advance', 'expected'] as const)
      p[field] = decimal(cents(p[field]) + cents(row[field]))
    if (row.due && row.due < asOf) p.overdue = decimal(cents(p.overdue) + cents(row.debt))
  }
  return [...parties.values()]
}
