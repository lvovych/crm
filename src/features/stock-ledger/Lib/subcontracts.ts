import { z } from 'zod'
import { calculateLine, D } from './amounts'
import { subcontractSchema, commandSchema, dateText } from './contracts'
import {
  ledgerCommand,
  metadata,
  assertPeriod,
  type LedgerDB,
  type LedgerContext,
} from './transaction'
import { nextDocumentNumber } from './numbers'
import { unallocate } from './settlements'
export function subcontractLineAmounts(line: {
  quantity: string
  unitCost: string
  taxMode: string
  taxRate: string
}) {
  const { netAmount, taxAmount, totalAmount } = calculateLine({
    inventoryPartId: 'subcontract',
    quantity: line.quantity,
    unitPrice: line.unitCost,
    discountType: 'NONE',
    discountValue: '0',
    taxMode: line.taxMode as 'NONE' | 'INCLUSIVE' | 'EXCLUSIVE',
    taxRate: line.taxRate,
  })
  return { netAmount, taxAmount, totalAmount }
}
const draftSchema = subcontractSchema.extend({
  id: z.string().optional(),
  expectedVersion: z.number().int().positive().optional(),
})
const transitionSchema = commandSchema.extend({
  id: z.string().min(1),
  expectedVersion: z.number().int().positive(),
})
const reverseSchema = transitionSchema.extend({
  effectiveAt: dateText,
  reason: z.string().trim().min(5).max(2000),
})
export function subcontractOperations(db: LedgerDB, ctx: LedgerContext) {
  const org = { organizationId: ctx.organizationId },
    meta = metadata(ctx)
  return {
    async save(raw: unknown) {
      const input = draftSchema.parse(raw)
      return ledgerCommand(db, ctx, 'subcontract.draft', input, async (tx) => {
        const supplier = await tx.supplier.findFirst({
          where: {
            ...org,
            id: input.supplierId,
            archivedAt: null,
            kind: { in: ['SERVICES', 'BOTH'] },
          },
        })
        if (!supplier) throw new Error('Виберіть постачальника послуг')
        const old = input.id
          ? await tx.supplierServiceDocument.findFirst({ where: { ...org, id: input.id } })
          : null
        if (input.id && (!old || old.status !== 'DRAFT' || old.version !== input.expectedVersion))
          throw new Error('Чернетку вже змінено. Оновіть сторінку')
        const total = input.lines.reduce(
          (sum, line) => sum.plus(subcontractLineAmounts(line).totalAmount),
          D(0)
        )
        if (total.lte(0)) throw new Error('Сума послуги має бути додатною')
        for (const line of input.lines) {
          const job = await tx.serviceRecord.findFirst({
            where: { ...org, id: line.serviceRecordId },
          })
          if (!job) throw new Error('Наряд не знайдений')
          if (
            line.serviceLaborId &&
            !(await tx.serviceLabor.findFirst({
              where: {
                id: line.serviceLaborId,
                serviceRecordId: job.id,
                executionType: 'SUBCONTRACT',
              },
            }))
          )
            throw new Error('Спочатку збережіть роботу з типом «Підрядник»')
        }
        const data = {
          supplierId: input.supplierId,
          externalNumber: input.externalNumber,
          effectiveAt: input.effectiveAt,
          dueDate: input.dueDate,
          totalAmount: total,
        }
        const doc = old
          ? await tx.supplierServiceDocument.update({
              where: { id: old.id },
              data: { ...data, version: { increment: 1 } },
            })
          : await tx.supplierServiceDocument.create({
              data: {
                ...meta,
                ...data,
                status: 'DRAFT',
                number: await nextDocumentNumber(tx, ctx, 'SC', input.effectiveAt),
              },
            })
        if (old) await tx.supplierServiceLine.deleteMany({ where: { ...org, documentId: old.id } })
        for (const line of input.lines)
          await tx.supplierServiceLine.create({
            data: {
              ...meta,
              documentId: doc.id,
              serviceRecordId: line.serviceRecordId,
              serviceLaborId: line.serviceLaborId,
              descriptionSnapshot: line.description,
              quantity: line.quantity,
              unitCost: line.unitCost,
              taxMode: line.taxMode,
              taxRate: line.taxRate,
              ...subcontractLineAmounts(line),
            },
          })
        return { id: doc.id, version: doc.version, total: total.toFixed(2), status: doc.status }
      })
    },
    async transition(raw: unknown, cancel = false) {
      const input = transitionSchema.parse(raw)
      return ledgerCommand(
        db,
        ctx,
        cancel ? 'subcontract.cancel' : 'subcontract.approve',
        input,
        async (tx) => {
          const doc = await tx.supplierServiceDocument.findFirst({
            where: { ...org, id: input.id },
            include: { supplier: true, supplierServiceLine_document: true },
          })
          if (!doc || doc.status !== 'DRAFT' || doc.version !== input.expectedVersion)
            throw new Error('Чернетку вже змінено. Оновіть сторінку')
          if (!cancel) {
            await assertPeriod(tx, ctx, doc.effectiveAt, false)
            if (doc.supplier.archivedAt || doc.supplier.kind === 'GOODS')
              throw new Error('Постачальник послуг недоступний')
            if (!doc.supplierServiceLine_document.length) throw new Error('Додайте послугу')
            const total = doc.supplierServiceLine_document.reduce(
              (sum, l) => sum.plus(l.totalAmount),
              D(0)
            )
            if (!total.eq(doc.totalAmount)) throw new Error('Підсумок документа не збігається')
            const party = await tx.settlementParty.findUniqueOrThrow({
              where: { organizationId_supplierId: { ...org, supplierId: doc.supplierId } },
            })
            await tx.settlementEntry.create({
              data: {
                ...meta,
                partyId: party.id,
                side: 'AP',
                polarity: 'DEBIT',
                amount: doc.totalAmount,
                effectiveAt: doc.effectiveAt,
                dueDate: doc.dueDate,
                supplierServiceDocumentId: doc.id,
                operationKey: 'subcontract:' + doc.id,
              },
            })
          }
          const saved = await tx.supplierServiceDocument.update({
            where: { id: doc.id },
            data: { status: cancel ? 'CANCELLED' : 'POSTED', version: { increment: 1 } },
          })
          return { id: saved.id, version: saved.version, status: saved.status }
        }
      )
    },
    async reverse(raw: unknown) {
      const input = reverseSchema.parse(raw)
      return ledgerCommand(db, ctx, 'subcontract.reverse', input, async (tx) => {
        await assertPeriod(tx, ctx, input.effectiveAt, false)
        const doc = await tx.supplierServiceDocument.findFirst({
          where: { ...org, id: input.id },
          include: { reversals: true, supplierServiceLine_document: true },
        })
        if (
          !doc ||
          doc.status !== 'POSTED' ||
          doc.reversalOfId ||
          doc.reversals.length ||
          doc.version !== input.expectedVersion
        )
          throw new Error('Документ недоступний для сторно')
        if (input.effectiveAt < doc.effectiveAt)
          throw new Error('Сторно не може передувати послузі')
        const entry = await tx.settlementEntry.findFirstOrThrow({
          where: { ...org, supplierServiceDocumentId: doc.id, polarity: 'DEBIT' },
        })
        const allocations = await tx.settlementAllocation.findMany({
          where: { ...org, debitEntryId: entry.id, reversedAt: null },
        })
        for (const a of allocations)
          await unallocate(tx, ctx, a.id, input.effectiveAt, input.reason)
        const reversal = await tx.supplierServiceDocument.create({
          data: {
            ...meta,
            supplierId: doc.supplierId,
            number: await nextDocumentNumber(tx, ctx, 'SCR', input.effectiveAt),
            effectiveAt: input.effectiveAt,
            dueDate: input.effectiveAt,
            totalAmount: doc.totalAmount,
            reversalOfId: doc.id,
            reason: input.reason,
          },
        })
        for (const line of doc.supplierServiceLine_document) {
          const { id, createdAt, documentId, createdById, organizationId, ...values } = line
          await tx.supplierServiceLine.create({
            data: { ...meta, ...values, documentId: reversal.id },
          })
        }
        const credit = await tx.settlementEntry.create({
          data: {
            ...meta,
            partyId: entry.partyId,
            side: 'AP',
            polarity: 'CREDIT',
            amount: entry.amount,
            effectiveAt: input.effectiveAt,
            supplierServiceDocumentId: reversal.id,
            reversalOfId: entry.id,
            operationKey: 'subcontract.reverse:' + doc.id,
          },
        })
        await tx.settlementAllocation.create({
          data: {
            ...meta,
            debitEntryId: entry.id,
            creditEntryId: credit.id,
            amount: entry.amount,
            effectiveAt: input.effectiveAt,
            operationKey: 'subcontract.reverse:' + doc.id,
          },
        })
        return { id: reversal.id, reversedId: doc.id, total: doc.totalAmount.toFixed(2) }
      })
    },
  }
}
