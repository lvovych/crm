import { z } from 'zod'
const text = z.string().trim().max(2000).default('')
export const supplierSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    legalName: text,
    kind: z.enum(['company', 'entrepreneur', 'person', 'unknown']).default('unknown'),
    country: z
      .string()
      .trim()
      .length(2)
      .transform((v) => v.toUpperCase())
      .default('UA'),
    taxId: z.string().trim().max(40).default(''),
    address: text,
    website: z
      .union([
        z.literal(''),
        z
          .string()
          .url()
          .max(2000)
          .refine((v) => /^https?:\/\//i.test(v), 'HTTP(S) required'),
      ])
      .default(''),
    notes: text,
    paymentTermDays: z.number().int().min(0).max(3650).nullable().default(null),
    paymentTerms: text,
    contacts: z
      .array(
        z.object({
          name: text,
          role: text,
          phone: z.string().trim().max(60).default(''),
          email: z.union([z.literal(''), z.string().email().max(254)]).default(''),
          isPrimary: z.boolean().default(false),
        })
      )
      .max(30)
      .default([]),
    bankAccounts: z
      .array(
        z.object({
          accountNumber: z.string().trim().min(1).max(100),
          bankName: text,
          currency: z
            .string()
            .regex(/^[A-Z]{3}$/)
            .default('UAH'),
          isPrimary: z.boolean().default(false),
        })
      )
      .max(20)
      .default([]),
  })
  .refine((v) => v.contacts.filter((c) => c.isPrimary).length <= 1, 'Only one primary contact')
  .refine(
    (v) => v.bankAccounts.filter((c) => c.isPrimary).length <= 1,
    'Only one primary bank account'
  )
export type SupplierInput = z.infer<typeof supplierSchema>
export const supplierListSchema = z.object({
  search: z.string().trim().max(200).default(''),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  archived: z.enum(['active', 'archived', 'all']).default('active'),
  source: z.enum(['all', 'carbook', 'manual']).default('all'),
})
