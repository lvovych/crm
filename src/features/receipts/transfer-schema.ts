import { z } from 'zod'
export const transferSchema = z
  .object({
    receiptId: z.string().min(1),
    requestId: z.uuid(),
    serviceRecordId: z.string().min(1),
    lines: z
      .array(
        z.object({
          id: z.string().min(1),
          quantity: z
            .string()
            .regex(/^\d{1,9}(\.\d{1,3})?$/)
            .refine((v) => Number(v) > 0),
          unitPrice: z.string().regex(/^\d{1,9}(\.\d{1,4})?$/),
        })
      )
      .min(1)
      .max(500),
  })
  .refine(
    (v) => new Set(v.lines.map((l) => l.id)).size === v.lines.length,
    'Позицію вказано двічі.'
  )
export type TransferInput = z.infer<typeof transferSchema>
export function quantityUnits(value: string): bigint {
  if (!/^\d{1,11}(\.\d{1,3})?$/.test(value)) throw new Error('Некоректна кількість.')
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole) * BigInt(1000) + BigInt(fraction.padEnd(3, '0'))
}
export function availableQuantity(received: string, sent: string[]): string {
  const remaining = sent.reduce((n, q) => n - quantityUnits(q), quantityUnits(received))
  if (remaining < BigInt(0)) throw new Error('Передано більше, ніж отримано.')
  return `${remaining / BigInt(1000)}.${String(remaining % BigInt(1000)).padStart(3, '0')}`
}
