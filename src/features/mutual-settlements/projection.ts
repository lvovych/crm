import { Prisma } from '@/generated/prisma/client'
import { cents, decimal } from '@/features/finance/money'
import { zonedDayKey } from '@/lib/timezone'
import type { PartyRow, DocumentRow } from './types'

export type CustomerSource = {
  id: string
  title: string
  invoiceNumber: string | null
  status: string
  totalAmount: number
  cost: number
  hasPricedLines: boolean
  manuallyPaid: boolean
  invoiceDueDate: Date | null
  invoiceDate: Date | null
  serviceDate: Date
  vehicleId: string | null
  customer: { id: string; name: string; phone: string | null } | null
  payments: { amount: number; amountExact: string | null; date: Date }[]
}

/** Round legacy values individually; sum integer kopecks, never binary floats. */
export function legacyMoney(value: number): bigint {
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER / 100)
    throw new Error('Неперевірена сума')
  return cents(new Prisma.Decimal(value.toString()).toFixed(2, Prisma.Decimal.ROUND_HALF_UP))
}
export function summarize(party: PartyRow, asOf: string): PartyRow {
  const total = (key: 'debt' | 'advance' | 'expected') =>
    decimal(party.documents.reduce((sum, d) => sum + cents(d[key]), BigInt(0)))
  return {
    ...party,
    debt: total('debt'),
    advance: total('advance'),
    expected: total('expected'),
    overdue: decimal(
      party.documents.reduce(
        (sum, d) => sum + (d.due && d.due < asOf ? cents(d.debt) : BigInt(0)),
        BigInt(0)
      )
    ),
  }
}
export function projectCustomers(
  records: CustomerSource[],
  today: string,
  zone: string
): PartyRow[] {
  const parties = new Map<string, PartyRow>()
  for (const r of records) {
    const customer = r.customer
    const key = customer?.id ?? 'unassigned'
    let party = parties.get(key)
    if (!party) {
      party = {
        id: key,
        name: customer?.name || 'Клієнт не визначений',
        phone: customer?.phone || '',
        kind: 'customer',
        archived: false,
        debt: '0.00',
        advance: '0.00',
        overdue: '0.00',
        expected: '0.00',
        documents: [],
      }
      parties.set(key, party)
    }
    const reasons: string[] = []
    if (!customer) reasons.push('Не визначений клієнт')
    if (r.manuallyPaid) reasons.push('Позначено оплаченим вручну — потрібна звірка')
    let amount: bigint | null = null,
      paid: bigint | null = null
    try {
      if (!Number.isFinite(r.totalAmount) || r.totalAmount < 0 || r.cost < 0)
        throw new Error('negative total')
      amount = legacyMoney(r.hasPricedLines || r.totalAmount > 0 ? r.totalAmount : r.cost)
      paid = r.payments
        .filter((p) => zonedDayKey(p.date, zone) <= today)
        .reduce(
          (sum, p) => sum + (p.amountExact !== null ? cents(p.amountExact) : legacyMoney(p.amount)),
          BigInt(0)
        )
      if (
        paid < BigInt(0) ||
        r.payments.some(
          (p) => (p.amountExact !== null ? cents(p.amountExact) : legacyMoney(p.amount)) < BigInt(0)
        )
      )
        reasons.push('Є від’ємна оплата — перевірте повернення')
    } catch {
      reasons.push('Некоректна або надто велика сума')
      amount = null
      paid = null
    }
    if (r.payments.some((p) => zonedDayKey(p.date, zone) > today))
      reasons.push('Є оплата майбутньою датою')
    const cancelled = r.status === 'cancelled' || r.status === 'canceled'
    if (cancelled && paid !== null && paid !== BigInt(0))
      reasons.push('Оплата за скасованим нарядом')
    if (cancelled && !reasons.length) continue
    const valid = !reasons.length && amount !== null && paid !== null
    const completed = r.status === 'completed'
    const open = valid && completed ? amount! - paid! : BigInt(0)
    const document: DocumentRow = {
      id: r.id,
      label: r.invoiceNumber || r.title || 'Наряд без номера',
      href: r.vehicleId ? `/vehicles/${r.vehicleId}/service/${r.id}` : `/sales/${r.id}`,
      date: zonedDayKey(r.invoiceDate ?? r.serviceDate, zone),
      due: r.invoiceDueDate ? zonedDayKey(r.invoiceDueDate, zone) : null,
      amount: amount === null ? null : decimal(amount),
      paid: paid === null ? null : decimal(paid),
      debt: decimal(open > 0 ? open : BigInt(0)),
      advance: decimal(valid ? (completed ? (open < 0 ? -open : BigInt(0)) : paid!) : BigInt(0)),
      expected: decimal(valid && !completed ? amount! : BigInt(0)),
      reason: reasons.join('. ') || null,
      provisional: true,
    }
    party.documents.push(document)
  }
  return [...parties.values()]
    .filter((p) => p.documents.length)
    .map((p) => summarize(p, today))
    .sort((a, b) => a.name.localeCompare(b.name, 'uk'))
}
