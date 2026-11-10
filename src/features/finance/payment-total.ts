import { cents, decimal } from './money'
/** Compatibility output for existing invoice consumers; accumulate in exact cents. */
export function paymentTotal(
  payments:
    | readonly { amount: number; amountExact?: { toString(): string } | string | null }[]
    | undefined
): number {
  return Number(
    decimal(
      (payments ?? []).reduce(
        (sum, p) => sum + cents(p.amountExact?.toString() ?? p.amount.toFixed(2)),
        BigInt('0')
      )
    )
  )
}
