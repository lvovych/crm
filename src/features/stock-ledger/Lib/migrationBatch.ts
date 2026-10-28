import { assertProductQuantity } from './catalogs'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { D, decimalText, quantityText, moneyText } from './amounts'
import { commandSchema } from './contracts'
import { ledgerCommand, metadata, type LedgerDB, type LedgerContext, type Tx } from './transaction'
import { createStockAdjustments } from './adjustments'
import { createStockOperations } from './stock'
import { createFinance } from './finance'
import { createStockLedger } from './service'
import { nextDocumentNumber } from './numbers'
import { fullReconciliation } from './reconciliation'
import { approveStockCutover, STOCK_CUTOVER_KEY, FINANCE_CUTOVER_KEY } from './cutover'
const exactMoney = decimalText.refine((v) => D(v).decimalPlaces() <= 2, 'Сума до копійок')
export const migrationManifest = z.object({
  version: z.literal(1),
  effectiveDate: z.iso.date(),
  sourceChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  stock: z
    .array(
      z.object({
        warehouseId: z.string().min(1),
        lines: z
          .array(
            z.object({
              inventoryPartId: z.string().min(1),
              quantity: quantityText,
              unitPrice: decimalText,
              expectedLegacyQuantity: z.string().regex(/^-?\d+(?:\.\d+)?$/),
            })
          )
          .min(1)
          .max(100),
      })
    )
    .max(100),
  balances: z
    .array(
      z.object({
        partyId: z.string().optional(),
        accountId: z.string().optional(),
        side: z.enum(['AP', 'AR']).optional(),
        polarity: z.enum(['DEBIT', 'CREDIT']).optional(),
        amount: moneyText,
        note: z.string().min(5),
      })
    )
    .max(1000),
  jobs: z
    .array(
      z.object({
        id: z.string().min(1),
        expectedUpdatedAt: z.iso.datetime(),
        expectedTotal: exactMoney,
        expectedPaid: exactMoney,
        expectedManuallyPaid: z.boolean(),
        parts: z
          .array(
            z.object({
              servicePartId: z.string().min(1),
              issuedQuantity: decimalText,
              unitCost: decimalText,
              warehouseId: z.string().min(1),
            })
          )
          .max(500),
      })
    )
    .max(100),
  activate: z.boolean().default(false),
})
export function migrationChecksum(raw: unknown) {
  const manifest = migrationManifest.parse(raw)
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
}
const schema = commandSchema.extend({
  manifest: migrationManifest,
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  confirmed: z.literal(true),
})
class Preview extends Error {
  constructor(readonly result: Record<string, unknown>) {
    super('Migration preview rollback')
  }
}
export async function applyMigrationBatch(
  db: LedgerDB,
  ctx: LedgerContext,
  raw: unknown,
  preview = false
) {
  const input = schema.parse(raw),
    m = input.manifest,
    org = { organizationId: ctx.organizationId },
    meta = metadata(ctx)
  if (migrationChecksum(m) !== input.checksum)
    throw new Error('Контрольна сума пакета не збігається')
  try {
    return await ledgerCommand(db, ctx, 'migration.apply', input, async (tx) => {
      const existing = await tx.ledgerMigrationBatch.findUnique({
        where: { organizationId_checksum: { ...org, checksum: input.checksum } },
      })
      if (existing)
        return {
          id: existing.id,
          checksum: existing.checksum,
          mapping: existing.mapping,
          alreadyApplied: true,
        }
      if (
        await tx.appSetting.findUnique({
          where: { organizationId_key: { ...org, key: STOCK_CUTOVER_KEY } },
        })
      )
        throw new Error('Перехід уже активовано. Нові початкові пакети заборонені')
      const nested = {
          $transaction: async (fn: (tx: Tx) => Promise<unknown>) => fn(tx),
        } as unknown as LedgerDB,
        finance = createFinance(nested, ctx),
        ledger = createStockLedger(nested, ctx),
        stock = createStockOperations(nested, ctx),
        date = new Date(m.effectiveDate + 'T00:00:00.000Z'),
        prefix = 'migrate:' + input.checksum.slice(0, 32)
      const mapping: { source: string; target: string; kind: string }[] = []
      const seen = new Set<string>()
      for (const [i, opening] of m.stock.entries()) {
        for (const line of opening.lines) {
          const identity = opening.warehouseId + ':' + line.inventoryPartId
          if (seen.has(identity)) throw new Error('Початковий товар/склад повторюється')
          seen.add(identity)
          const product = await tx.inventoryPart.findFirstOrThrow({
            where: { ...org, id: line.inventoryPartId },
          })
          if (!D(String(product.quantity)).eq(line.expectedLegacyQuantity))
            throw new Error('Старий залишок змінився після звірки')
        }
        const result = await createStockAdjustments(nested, ctx).opening({
          idempotencyKey: prefix + ':stock:' + i,
          warehouseId: opening.warehouseId,
          effectiveAt: m.effectiveDate,
          reason: 'Затверджений пакет міграції ' + input.checksum,
          lines: opening.lines,
        })
        mapping.push({ source: opening.warehouseId, target: result.id, kind: 'OPENING' })
      }
      for (const [i, b] of m.balances.entries()) {
        const result = await finance.openingBalance({
          idempotencyKey: prefix + ':balance:' + i,
          ...b,
          effectiveAt: m.effectiveDate,
          sourceNote: b.note,
          batchKey: prefix + ':balance:' + i,
        })
        mapping.push({ source: b.partyId ?? b.accountId ?? '', target: result.id, kind: 'BALANCE' })
      }
      const jobs = new Set<string>()
      for (const [i, j] of m.jobs.entries()) {
        if (jobs.has(j.id)) throw new Error('Наряд повторюється')
        jobs.add(j.id)
        await tx.$queryRaw`SELECT id FROM "public"."service_records" WHERE id=${j.id} AND "organizationId"=${ctx.organizationId} FOR UPDATE`
        const job = await tx.serviceRecord.findFirstOrThrow({
          where: { ...org, id: j.id },
          include: {
            partItems: true,
            payments: true,
            vehicle: { select: { customerId: true } },
          },
        })
        const paid = job.payments.reduce((s, p) => s.plus(String(p.amount)), D(0)),
          customerId = job.customerId ?? job.vehicle?.customerId
        if (
          job.status === 'completed' ||
          job.inventoryAccountingMode !== 'LEGACY' ||
          job.financeAccountingMode !== 'LEGACY'
        )
          throw new Error('Мігрувати можна лише відкритий історичний наряд')
        if (
          job.updatedAt.toISOString() !== j.expectedUpdatedAt ||
          !D(String(job.totalAmount)).eq(j.expectedTotal) ||
          !paid.eq(j.expectedPaid) ||
          job.manuallyPaid !== j.expectedManuallyPaid
        )
          throw new Error('Наряд або його оплати змінилися після звірки')
        if (!customerId || D(j.expectedTotal).lte(0))
          throw new Error('Для перенесення наряду потрібні платник і додатна сума')
        const nonStock = new Set(
          (
            await tx.inventoryPart.findMany({
              where: {
                ...org,
                id: {
                  in: job.partItems.flatMap((p) => (p.inventoryPartId ? [p.inventoryPartId] : [])),
                },
                trackingMode: 'NON_STOCK',
              },
              select: { id: true },
            })
          ).map((p) => p.id)
        )
        const own = job.partItems.filter(
          (p) =>
            p.stockOwnership === 'OWN' && p.quantity > 0 && !nonStock.has(p.inventoryPartId ?? '')
        )
        if (
          own.length !== j.parts.length ||
          new Set(j.parts.map((p) => p.servicePartId)).size !== j.parts.length ||
          own.some((p) => !j.parts.some((x) => x.servicePartId === p.id))
        )
          throw new Error('Звірте кожну власну деталь наряду')
        await tx.serviceRecord.update({
          where: { id: job.id },
          data: { inventoryAccountingMode: 'LEDGER', financeAccountingMode: 'LEDGER' },
        })
        for (const [k, line] of j.parts.entries()) {
          const part = own.find((p) => p.id === line.servicePartId)!
          if (D(line.issuedQuantity).gt(String(part.quantity)))
            throw new Error('Історично видано більше потреби')
          const demand = await stock.createDemand({
            idempotencyKey: prefix + ':d:' + i + ':' + k,
            servicePartId: part.id,
          })
          if (D(line.issuedQuantity).isZero()) continue
          if (D(line.issuedQuantity).decimalPlaces() > 3)
            throw new Error('Точність кількості до трьох знаків')
          const warehouse = await tx.warehouse.findFirstOrThrow({
              where: { ...org, id: line.warehouseId, archivedAt: null },
            }),
            product = await tx.inventoryPart.findFirstOrThrow({
              where: { ...org, id: part.inventoryPartId! },
              include: { brand: true },
            })
          await assertProductQuantity(tx, ctx, product, line.issuedQuantity, true)
          const doc = await tx.inventoryDocument.create({
            data: {
              ...meta,
              kind: 'MIGRATION_ISSUE',
              number: await nextDocumentNumber(tx, ctx, 'MIG', date),
              effectiveAt: date,
              sourceWarehouseId: warehouse.id,
              note: 'Історично видано до переходу; без списання початкового залишку',
            },
          })
          const documentLine = await tx.inventoryDocumentLine.create({
            data: {
              ...meta,
              documentId: doc.id,
              inventoryPartId: product.id,
              quantity: line.issuedQuantity,
              unitPrice: line.unitCost,
              discountAmount: 0,
              netAmount: 0,
              taxAmount: 0,
              totalAmount: 0,
              snapshotName: product.name,
              snapshotBrand: product.brand.name,
              snapshotArticle: product.partNumber,
              snapshotUnit: product.unit ?? 'pcs',
              sortOrder: 0,
            },
          })
          const lot = await tx.stockLot.create({
            data: {
              ...meta,
              inventoryPartId: product.id,
              sourceLineId: documentLine.id,
              acquiredAt: date,
              unitCost: line.unitCost,
            },
          })
          await tx.stockLotBalance.create({
            data: { ...meta, lotId: lot.id, warehouseId: warehouse.id, onHandQty: 0 },
          })
          const allocation = await tx.documentLotAllocation.create({
            data: {
              ...meta,
              documentLineId: documentLine.id,
              lotId: lot.id,
              warehouseId: warehouse.id,
              demandId: demand.id,
              quantity: line.issuedQuantity,
              unitCostSnapshot: line.unitCost,
              costAmountSnapshot: D(line.issuedQuantity).mul(line.unitCost).toDecimalPlaces(6),
            },
          })
          await tx.inventoryDocument.update({
            where: { id: doc.id },
            data: { status: 'POSTED', postedAt: new Date(), version: { increment: 1 } },
          })
          mapping.push({ source: part.id, target: allocation.id, kind: 'MIGRATION_ALLOCATION' })
        }
        await finance.issueCustomerCharge({
          idempotencyKey: prefix + ':charge:' + i,
          serviceRecordId: job.id,
          customerId,
          effectiveAt: m.effectiveDate,
          dueDate: m.effectiveDate,
        })
        const debit = await tx.settlementEntry.findFirstOrThrow({
            where: { ...org, serviceRecordId: job.id },
          }),
          settled = job.manuallyPaid && paid.lt(j.expectedTotal) ? D(j.expectedTotal) : paid
        if (settled.gt(0)) {
          const opening = await finance.openingBalance({
            idempotencyKey: prefix + ':paid:' + i,
            partyId: debit.partyId,
            side: 'AR',
            polarity: 'CREDIT',
            amount: settled.toFixed(2),
            effectiveAt: m.effectiveDate,
            batchKey: prefix + ':paid:' + i,
            sourceNote: job.manuallyPaid
              ? 'Історично позначено оплаченим; без нової касової операції'
              : 'Історичні Payment; без нової касової операції',
          })
          const credit = await tx.settlementEntry.findFirstOrThrow({
            where: { ...org, openingBalanceId: opening.id },
          })
          await ledger.allocateSettlement({
            idempotencyKey: prefix + ':allocate:' + i,
            debitEntryId: debit.id,
            creditEntryId: credit.id,
            amount: (settled.lt(debit.amount) ? settled : debit.amount).toFixed(2),
            effectiveAt: m.effectiveDate,
          })
          mapping.push({ source: job.id, target: opening.id, kind: 'HISTORICAL_PAYMENT' })
        }
        mapping.push({ source: job.id, target: debit.id, kind: 'AR' })
      }
      if ((await fullReconciliation(tx, ctx)).length)
        throw new Error('Пакет не пройшов звірку журналів')
      const batch = await tx.ledgerMigrationBatch.create({
        data: {
          ...meta,
          effectiveAt: date,
          checksum: input.checksum,
          sourceChecksum: m.sourceChecksum,
          manifest: m,
          mapping,
        },
      })
      if (m.activate) {
        const approval = await approveStockCutover(nested, ctx, {
          idempotencyKey: prefix + ':activate',
          effectiveDate: m.effectiveDate,
          manifestChecksum: input.checksum,
          stockVerified: true,
          supplierBalancesVerified: true,
          maintenanceConfirmed: true,
        })
        await tx.appSetting.create({
          data: {
            ...org,
            userId: ctx.userId,
            key: FINANCE_CUTOVER_KEY,
            value: JSON.stringify(approval),
          },
        })
      }
      const result = { id: batch.id, checksum: batch.checksum, mapping, alreadyApplied: false }
      if (preview) throw new Preview(result)
      return result
    })
  } catch (e) {
    if (e instanceof Preview) return { ...e.result, preview: true }
    throw e
  }
}
