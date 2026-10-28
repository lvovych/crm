import { z } from 'zod'
import { commandSchema, dateText } from './contracts'
import { quantityText, decimalText } from './amounts'
import { ledgerCommand, type LedgerDB, type LedgerContext, type Tx } from './transaction'
import { createStockOperations } from './stock'
import { createProcurement } from './procurement'
export const bulkSchema = commandSchema
  .extend({
    idempotencyKey: z.string().min(16).max(80),
    operation: z.enum(['reserve', 'issue', 'purchase']),
    warehouseId: z.string().min(1),
    supplierId: z.string().optional(),
    effectiveAt: dateText,
    lines: z
      .array(
        z.object({
          servicePartId: z.string().min(1),
          quantity: quantityText,
          unitPrice: decimalText.default('0'),
        })
      )
      .min(1)
      .max(100),
  })
  .refine(
    (i) => new Set(i.lines.map((l) => l.servicePartId)).size === i.lines.length,
    'Позиція повторюється'
  )
/** Reuses the same Prisma transaction, not a nested database transaction. */
function within(tx: Tx): LedgerDB {
  return { $transaction: async (fn: (tx: Tx) => Promise<unknown>) => fn(tx) } as unknown as LedgerDB
}
export async function bulkStockOperation(db: LedgerDB, ctx: LedgerContext, raw: unknown) {
  const input = bulkSchema.parse(raw)
  return ledgerCommand(db, ctx, 'stock.bulk', input, async (tx) => {
    const operations = createStockOperations(within(tx), ctx),
      rows: { servicePartId: string; name: string; quantity: string; id: string }[] = [],
      purchaseLines = []
    for (const [i, line] of input.lines.entries()) {
      const part = await tx.servicePart.findFirst({
        where: { id: line.servicePartId, serviceRecord: { organizationId: ctx.organizationId } },
      })
      if (!part) throw new Error(`Позиція ${i + 1}: не знайдена`)
      try {
        const demand = await operations.createDemand({
          idempotencyKey: input.idempotencyKey + ':d' + i,
          servicePartId: part.id,
        })
        if (input.operation === 'purchase') {
          purchaseLines.push({
            inventoryPartId: part.inventoryPartId!,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            allocations: [{ demandId: demand.id, quantity: line.quantity }],
          })
          rows.push({
            servicePartId: part.id,
            name: part.name,
            quantity: line.quantity,
            id: demand.id,
          })
        } else {
          const result = await operations[input.operation]({
            idempotencyKey: input.idempotencyKey + ':' + i,
            demandId: demand.id,
            warehouseId: input.warehouseId,
            quantity: line.quantity,
            effectiveAt: input.effectiveAt.toISOString().slice(0, 10),
          })
          rows.push({
            servicePartId: part.id,
            name: part.name,
            quantity: line.quantity,
            id: result.id,
          })
        }
      } catch (e) {
        throw new Error(`${part.name}: ${e instanceof Error ? e.message : 'Операція не виконана'}`)
      }
    }
    let purchaseId: string | null = null
    if (input.operation === 'purchase')
      purchaseId = (
        await createProcurement(within(tx), ctx).saveDraft({
          idempotencyKey: input.idempotencyKey + ':po',
          supplierId: input.supplierId,
          warehouseId: input.warehouseId,
          lines: purchaseLines,
        })
      ).id
    return { id: input.idempotencyKey, rows, purchaseId }
  })
}
class PreviewRollback extends Error {
  constructor(readonly result: Awaited<ReturnType<typeof bulkStockOperation>>) {
    super('Preview rollback')
  }
}
export async function previewBulkStock(db: LedgerDB, ctx: LedgerContext, raw: unknown) {
  try {
    await db.$transaction(
      async (tx) => {
        const result = await bulkStockOperation(within(tx), ctx, raw)
        throw new PreviewRollback(result)
      },
      { timeout: 20000 }
    )
  } catch (e) {
    if (e instanceof PreviewRollback) return e.result
    throw e
  }
  throw new Error('Попередній перегляд не завершено')
}
