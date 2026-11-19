import { z } from 'zod'
import { API_ORIGIN } from './client'
import { lineCents, decimalAmount } from '@/features/receipts/money'
import { parseFixed } from '@/lib/exact-money'
import type { ImportedReceipt, ReceiptReference } from '@/features/receipts/import-types'

const text = z.string().trim().min(1).max(1000)
const header = z.object({
  document_uuid: z.string().regex(/^(?:[a-f\d]{32}|[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/i),
  number: text.max(100),
  created_at: z.string().datetime({ offset: true }),
})
const decimal = z.union([z.number().finite(), z.string()]).transform(String)
const document = header.extend({
  currency: z.object({ name: z.enum(['UAH', 'ГРН', 'грн']) }),
  total: decimal,
  products: z
    .array(
      z.object({
        quantity: decimal,
        price: decimal,
        total: decimal,
        product: z.object({
          article: text,
          name: z.string().nullable().optional(),
          name_for_invoice: z.string().nullable().optional(),
          brand: z.object({ name: text }),
        }),
      })
    )
    .min(1)
    .max(200),
})

export function receiptReference(
  raw: unknown,
  period: { from: string; to: string }
): ReceiptReference {
  const parsed = header.safeParse(raw)
  if (!parsed.success) throw new Error('Бус Маркет: відсутній номер, дата або ID накладної.')
  const data = parsed.data
  // BM's period filter and document date use the supplier's ISO calendar date.
  const date = data.created_at.slice(0, 10)
  if (date < period.from || date > period.to)
    throw new Error('Бус Маркет: API повернув накладну поза запитаним періодом.')
  return {
    externalId: data.document_uuid,
    number: data.number,
    date,
    url: `${API_ORIGIN}/documents/0000013C/${data.document_uuid}`,
  }
}

export function parseReceipt(raw: unknown, reference: ReceiptReference): ImportedReceipt {
  try {
    const data = document.parse(raw)
    if (data.number !== reference.number || data.document_uuid !== reference.externalId)
      throw new Error('Reference mismatch')
    let total = BigInt(0)
    const lines = data.products.map((row) => {
      if (parseFixed(row.quantity, 3, { signed: false, wholeDigits: 9 }) <= BigInt(0))
        throw new Error('Invalid quantity')
      const cents = lineCents({ quantity: row.quantity, unitPrice: row.price })
      if (cents === null || cents !== parseFixed(row.total, 2, { signed: false }))
        throw new Error('Line total mismatch')
      total += cents
      const product = row.product
      return {
        brand: product.brand.name,
        article: product.article,
        name: (
          product.name_for_invoice ||
          product.name ||
          `${product.brand.name} ${product.article}`
        ).trim(),
        quantity: row.quantity,
        unitPrice: row.price,
        amount: decimalAmount(cents),
      }
    })
    if (total !== parseFixed(data.total, 2, { signed: false })) throw new Error('Total mismatch')
    return { ...reference, lines }
  } catch {
    throw new Error(
      `Бус Маркет: накладна ${reference.number} має некоректні дані, валюту або суми.`
    )
  }
}
