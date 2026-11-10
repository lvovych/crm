import { z } from 'zod'

/** API and ledger amounts never pass through binary floating point. */
export function cents(value: string): bigint {
  if (!/^-?\d{1,20}(\.\d{1,2})?$/.test(value))
    throw new Error('Вкажіть суму з точністю до копійки.')
  const negative = value.startsWith('-')
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.')
  const n = BigInt(whole) * BigInt('100') + BigInt(fraction.padEnd(2, '0'))
  return negative ? -n : n
}
export function decimal(value: bigint): string {
  const n = value < BigInt('0') ? -value : value
  return `${value < BigInt('0') ? '-' : ''}${n / BigInt('100')}.${String(n % BigInt('100')).padStart(2, '0')}`
}
export function normalizeMoney(value: string): string {
  return decimal(
    cents(
      value
        .trim()
        .replace(/[ \u00a0\u202f]/g, '')
        .replace(',', '.')
    )
  )
}
export const positiveMoney = z
  .string()
  .transform((value, ctx) => {
    try {
      return normalizeMoney(value)
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Вкажіть суму з точністю до копійки.' })
      return z.NEVER
    }
  })
  .refine((v) => cents(v) > BigInt('0'), 'Сума має бути більшою за нуль.')
export const transactionInput = z.object({
  requestId: z.string().uuid(),
  kind: z.enum(['income', 'expense', 'transfer']),
  date: z.string().date(),
  amount: positiveMoney,
  sourceAccountId: z.string().optional(),
  targetAccountId: z.string().optional(),
  categoryId: z.string().optional(),
  counterpartyLabel: z.string().trim().max(200).optional(),
  note: z.string().trim().min(1).max(1000),
})
export function assertHistoricalBalance(
  rows: { date: string; amount: string }[],
  date: string,
  delta: bigint
) {
  const days = new Map<string, bigint>()
  for (const row of rows)
    days.set(row.date, (days.get(row.date) ?? BigInt('0')) + cents(row.amount))
  days.set(date, (days.get(date) ?? BigInt('0')) + delta)
  let balance = BigInt('0')
  for (const [day, amount] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    balance += amount
    if (day >= date && balance < BigInt('0')) throw new Error(`Недостатньо коштів на ${day}.`)
  }
}
