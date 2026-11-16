import { decimalAmount } from '@/features/receipts/money'
export function kopecks(input: string): bigint {
  if (!/^\d{1,20}(\.\d{1,2})?$/.test(input))
    throw new Error('Вкажіть суму у гривнях з точністю до копійки.')
  const [whole, fraction = ''] = input.split('.')
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'))
}
export function hryvnia(n: bigint) {
  return n < BigInt(0) ? '-' + decimalAmount(-n) : decimalAmount(n)
}
export function isCredit(kind: string) {
  return kind === 'payment' || kind === 'opening_credit' || kind === 'adjustment_credit'
}
export function supplierTotals(rows: { kind: string; open: string; overdue: boolean }[]) {
  let obligations = BigInt(0)
  let credits = BigInt(0)
  let advance = BigInt(0)
  let overdue = BigInt(0)
  for (const row of rows) {
    const amount = kopecks(row.open)
    if (isCredit(row.kind)) credits += amount
    else obligations += amount
    if (row.kind === 'payment' || row.kind === 'opening_credit') advance += amount
    if (row.overdue) overdue += amount
  }
  const net = obligations - credits
  // For this supplier total, cover past-due obligations first with unallocated credits.
  return {
    debt: hryvnia(net > 0 ? net : BigInt(0)),
    net: hryvnia(net),
    advance: hryvnia(advance),
    overdue: hryvnia(overdue > credits ? overdue - credits : BigInt(0)),
  }
}
export function day(date: Date) {
  return date.toISOString().slice(0, 10)
}
export function workshopDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}
type Event = { amount: { toString(): string }; date: Date; reversedAt: Date | null }
export function activeOn(row: Event, asOf: string) {
  return day(row.date) <= asOf && (!row.reversedAt || workshopDay(row.reversedAt) > asOf)
}
export function remaining(row: Event, links: Event[], asOf: string) {
  if (!activeOn(row, asOf)) return BigInt(0)
  return links
    .filter((l) => activeOn(l, asOf))
    .reduce((balance, l) => balance - kopecks(l.amount.toString()), kopecks(row.amount.toString()))
}
export function splitPayment(payment: bigint, debt: bigint) {
  const applied = payment < debt ? payment : debt
  return { applied, advance: payment - applied, open: debt - applied }
}

// Changes are ordered by effective timestamp. A report before the first
// later amendment uses the due date that amendment replaced.
export function dueOn(
  current: Date | null,
  changes: { changedAt: Date; previous: Date | null }[],
  asOf: string
) {
  const later = changes.find((c) => workshopDay(c.changedAt) > asOf)
  const due = later ? later.previous : current
  return due ? day(due) : null
}
export function suggestedDistribution(
  available: string,
  obligations: { id: string; open: string }[]
) {
  let left = kopecks(available)
  const result: Record<string, string> = {}
  for (const d of obligations) {
    const { applied, advance } = splitPayment(left, kopecks(d.open))
    if (applied > 0) result[d.id] = hryvnia(applied)
    left = advance
  }
  return result
}
