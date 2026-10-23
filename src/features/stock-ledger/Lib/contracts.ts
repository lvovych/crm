import { z } from 'zod'
import { lineSchema, moneyText, quantityText, decimalText } from './amounts'
export const dateText = z.iso.date().transform((v) => new Date(`${v}T00:00:00.000Z`))
export const commandSchema = z.object({ idempotencyKey: z.string().min(16).max(100) })
export const supplierSchema = commandSchema.extend({
  name: z.string().trim().min(1).max(200),
  kind: z.enum(['GOODS', 'SERVICES', 'BOTH']).default('GOODS'),
  phone: z.string().max(100).default(''),
  email: z.union([z.email(), z.literal('')]).default(''),
  taxId: z.string().max(50).default(''),
  paymentTermsDays: z.number().int().min(0).max(365).default(0),
})
export const warehouseSchema = commandSchema.extend({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(200),
  reservable: z.boolean().default(true),
})
export const accountSchema = commandSchema.extend({
  name: z.string().trim().min(1).max(200),
  kind: z.enum(['CASH', 'BANK', 'CARD_CLEARING']).default('BANK'),
})
export const receiptSchema = commandSchema.extend({
  autoAllocatePurchase: z.boolean().default(false),
  documentId: z.string().optional(),
  expectedVersion: z.number().int().positive().optional(),
  supplierId: z.string().min(1),
  warehouseId: z.string().min(1),
  effectiveAt: dateText,
  externalNumber: z.string().trim().min(1).max(100),
  externalDate: dateText,
  dueDate: dateText,
  note: z.string().max(2000).default(''),
  lines: z.array(lineSchema).min(1).max(10000),
})
export const postSchema = commandSchema.extend({
  documentId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
})
export const paymentSchema = commandSchema.extend({
  partyId: z.string().min(1),
  accountId: z.string().min(1),
  direction: z.enum(['IN', 'OUT']),
  amount: moneyText,
  effectiveAt: dateText,
  method: z.string().trim().min(1).max(50),
  note: z.string().max(2000).default(''),
})
export const allocationSchema = commandSchema.extend({
  debitEntryId: z.string().min(1),
  creditEntryId: z.string().min(1),
  amount: moneyText,
  effectiveAt: dateText,
})
export const demandSchema = commandSchema.extend({ servicePartId: z.string().min(1) })
export const reserveSchema = commandSchema.extend({
  demandId: z.string().min(1),
  warehouseId: z.string().min(1),
  quantity: quantityText,
  effectiveAt: dateText,
})
export const releaseSchema = commandSchema.extend({
  reservationId: z.string().min(1),
  quantity: quantityText,
  effectiveAt: dateText,
})
export const returnSchema = commandSchema.extend({
  allocationId: z.string().min(1),
  warehouseId: z.string().min(1),
  quantity: quantityText,
  effectiveAt: dateText,
  reason: z.string().trim().min(1).max(1000),
})
export const transferSchema = commandSchema.extend({
  lotId: z.string().min(1),
  sourceWarehouseId: z.string().min(1),
  targetWarehouseId: z.string().min(1),
  quantity: quantityText,
  effectiveAt: dateText,
})
export const supplierReturnSchema = commandSchema.extend({
  lotId: z.string().min(1),
  warehouseId: z.string().min(1),
  quantity: quantityText,
  effectiveAt: dateText,
  reason: z.string().trim().min(1).max(1000),
})
export const reversalSchema = commandSchema.extend({
  id: z.string().min(1),
  effectiveAt: dateText,
  reason: z.string().trim().min(1).max(1000),
})
export const purchaseSchema = commandSchema.extend({
  supplierId: z.string().min(1),
  warehouseId: z.string().min(1),
  expectedAt: dateText.optional(),
  note: z.string().max(2000).default(''),
  lines: z
    .array(
      z.object({
        inventoryPartId: z.string().min(1),
        quantity: quantityText,
        unitPrice: decimalText,
        allocations: z
          .array(z.object({ demandId: z.string().min(1), quantity: quantityText }))
          .default([]),
      })
    )
    .min(1)
    .max(100),
})
export const receiptAllocationSchema = commandSchema.extend({
  documentId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  allocations: z
    .array(
      z.object({
        receiptLineId: z.string().min(1),
        demandId: z.string().min(1),
        quantity: quantityText,
        purchaseAllocationId: z.string().optional(),
      })
    )
    .max(200),
})
export const openingStockSchema = commandSchema.extend({
  warehouseId: z.string().min(1),
  effectiveAt: dateText,
  reason: z.string().trim().min(5).max(2000),
  lines: z
    .array(
      z.object({
        inventoryPartId: z.string().min(1),
        quantity: quantityText,
        unitPrice: decimalText,
      })
    )
    .min(1)
    .max(100),
})
export const adjustmentSchema = commandSchema.extend({
  balanceId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  countedQuantity: decimalText,
  reason: z.string().trim().min(5).max(2000),
  effectiveAt: dateText,
})
export const subcontractSchema = commandSchema.extend({
  supplierId: z.string().min(1),
  externalNumber: z.string().trim().min(1).max(100),
  effectiveAt: dateText,
  dueDate: dateText,
  lines: z
    .array(
      z.object({
        serviceRecordId: z.string().min(1),
        description: z.string().trim().min(1).max(1000),
        quantity: quantityText,
        unitCost: decimalText,
      })
    )
    .min(1)
    .max(100),
})
export const openingBalanceSchema = commandSchema
  .extend({
    partyId: z.string().optional(),
    accountId: z.string().optional(),
    side: z.enum(['AR', 'AP']).optional(),
    polarity: z.enum(['DEBIT', 'CREDIT']).optional(),
    amount: moneyText,
    effectiveAt: dateText,
    sourceNote: z.string().trim().min(5).max(2000),
    batchKey: z.string().min(8).max(100),
  })
  .refine(
    (v) => Boolean(v.partyId) !== Boolean(v.accountId),
    'Вкажіть або контрагента, або рахунок'
  )
export const chargeSchema = commandSchema.extend({
  serviceRecordId: z.string().min(1),
  customerId: z.string().min(1),
  effectiveAt: dateText,
  dueDate: dateText,
})

export const cancelDemandSchema = commandSchema.extend({
  demandId: z.string().min(1),
  reason: z.string().trim().min(5).max(1000),
})
