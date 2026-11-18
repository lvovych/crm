import { parseFixed, formatFixed } from '@/lib/exact-money'
import { roundAsPrinted } from '@/lib/money'
export type Finding = {
  entity: string
  id: string
  check: string
  expected: string
  actual: string
}
const printed = (n: number) => {
  if (!Number.isFinite(n)) throw new Error('Non-finite stored amount')
  return parseFixed(roundAsPrinted(n).toFixed(2))
}
export function reconcileInvoice(r: {
  id: string
  subtotal: number
  discountAmount: number
  taxAmount: number
  taxInclusive: boolean
  totalAmount: number
  lineTotals: number[]
}): Finding[] {
  const findings: Finding[] = []
  const check = (name: string, expected: bigint, actual: bigint) => {
    if (expected !== actual)
      findings.push({
        entity: 'ServiceRecord',
        id: r.id,
        check: name,
        expected: formatFixed(expected),
        actual: formatFixed(actual),
      })
  }
  if (r.lineTotals.length)
    check(
      'line-subtotal-review',
      r.lineTotals.reduce((s, n) => s + printed(n), BigInt(0)),
      printed(r.subtotal)
    )
  const base = printed(r.subtotal) - printed(r.discountAmount)
  check(
    'printed-total',
    (base > 0 ? base : BigInt(0)) + (r.taxInclusive ? BigInt(0) : printed(r.taxAmount)),
    printed(r.totalAmount)
  )
  return findings
}
export function reconcilePosting(r: {
  id: string
  amount: string
  sourceAccountId: string | null
  targetAccountId: string | null
  entries: { accountId: string; amount: string }[]
  paymentAmount?: string | null
}): Finding[] {
  const expected = new Map<string, bigint>()
  if (r.sourceAccountId) expected.set(r.sourceAccountId, -parseFixed(r.amount))
  if (r.targetAccountId) expected.set(r.targetAccountId, parseFixed(r.amount))
  const actual = new Map<string, bigint>()
  for (const e of r.entries)
    actual.set(e.accountId, (actual.get(e.accountId) ?? BigInt(0)) + parseFixed(e.amount))
  const findings: Finding[] = []
  for (const id of new Set([...expected.keys(), ...actual.keys()])) {
    const want = expected.get(id) ?? BigInt(0),
      have = actual.get(id) ?? BigInt(0)
    if (want !== have || !expected.has(id) || !actual.has(id))
      findings.push({
        entity: 'FinancialDocument',
        id: r.id,
        check: 'account-posting:' + id,
        expected: formatFixed(want),
        actual: formatFixed(have),
      })
  }
  if (
    r.paymentAmount !== undefined &&
    r.paymentAmount !== null &&
    parseFixed(r.paymentAmount) !== parseFixed(r.amount) &&
    -parseFixed(r.paymentAmount) !== parseFixed(r.amount)
  )
    findings.push({
      entity: 'FinancialDocument',
      id: r.id,
      check: 'linked-payment',
      expected: r.paymentAmount,
      actual: r.amount,
    })
  return findings
}
export function reconcileReturn(r: {
  id: string
  quantity: string
  amount: string
  returnedQuantity: string
  returnedAmount: string
  consumedQuantity: string
}): Finding[] {
  const original = parseFixed(r.quantity, 3),
    returned = parseFixed(r.returnedQuantity, 3),
    consumed = parseFixed(r.consumedQuantity, 3)
  const findings: Finding[] = []
  if (returned + consumed > original)
    findings.push({
      entity: 'SupplierReceiptLine',
      id: r.id,
      check: 'returned-and-consumed-quantity',
      expected: formatFixed(original, 3),
      actual: formatFixed(returned + consumed, 3),
    })
  if (
    parseFixed(r.returnedAmount) > parseFixed(r.amount) ||
    (returned === original && parseFixed(r.returnedAmount) !== parseFixed(r.amount))
  )
    findings.push({
      entity: 'SupplierReceiptLine',
      id: r.id,
      check: 'return-amount',
      expected: r.amount,
      actual: r.returnedAmount,
    })
  return findings
}
