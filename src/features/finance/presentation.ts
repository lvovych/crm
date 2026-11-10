import { cents, decimal } from './money'

/** Format decimal strings without losing cents on large balances. */
export function moneyLabel(value: string) {
  const [whole, fraction] = decimal(cents(value)).split('.')
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0')},${fraction} грн`
}
export function dayLabel(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('.') : value
}
export function groupMovements<T extends { documentId: string; kind: string; amount: string }>(
  rows: T[]
) {
  const groups: T[][] = []
  const transfers = new Map<string, T[]>()
  for (const row of rows) {
    if (row.kind !== 'transfer') {
      groups.push([row])
      continue
    }
    const existing = transfers.get(row.documentId)
    if (existing) existing.push(row)
    else {
      const group = [row]
      transfers.set(row.documentId, group)
      groups.push(group)
    }
  }
  return groups
}
