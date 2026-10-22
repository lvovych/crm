import { randomUUID } from 'node:crypto'
import { nextDocumentNumber } from './numbers'
import { postReceiptProcurement, refreshPurchaseOrders } from './procurement'
import { D, calculateLine } from './amounts'
import {
  accountSchema,
  allocationSchema,
  paymentSchema,
  postSchema,
  receiptSchema,
  supplierSchema,
  warehouseSchema,
} from './contracts'
import {
  assertPeriod,
  ledgerCommand,
  metadata,
  type LedgerContext,
  type LedgerDB,
  type Tx,
} from './transaction'

export function createStockLedger(db: LedgerDB, ctx: LedgerContext) {
  const org = { organizationId: ctx.organizationId },
    meta = metadata(ctx)
  return {
    async createSupplier(raw: unknown) {
      const input = supplierSchema.parse(raw)
      return ledgerCommand(db, ctx, 'supplier.create', input, async (tx) => {
        const { idempotencyKey, ...data } = input
        const supplier = await tx.supplier.create({
          data: {
            ...meta,
            ...data,
            taxId: data.taxId || null,
            normalizedName: data.name.normalize('NFKC').toLocaleLowerCase('uk'),
          },
        })
        const party = await tx.settlementParty.create({
          data: {
            ...meta,
            kind: 'SUPPLIER',
            supplierId: supplier.id,
            displayNameSnapshot: supplier.name,
          },
        })
        return { id: supplier.id, partyId: party.id }
      })
    },
    async createWarehouse(raw: unknown) {
      const input = warehouseSchema.parse(raw)
      return ledgerCommand(db, ctx, 'warehouse.create', input, async (tx) => {
        const { idempotencyKey, ...data } = input
        const warehouse = await tx.warehouse.create({
          data: { ...meta, ...data, isDefault: !(await tx.warehouse.count({ where: org })) },
        })
        return { id: warehouse.id }
      })
    },
    async createAccount(raw: unknown) {
      const input = accountSchema.parse(raw)
      return ledgerCommand(db, ctx, 'account.create', input, async (tx) => {
        const account = await tx.cashAccount.create({
          data: { ...meta, name: input.name, kind: input.kind },
        })
        return { id: account.id }
      })
    },
    async saveReceiptDraft(raw: unknown) {
      const input = receiptSchema.parse(raw)
      return ledgerCommand(db, ctx, 'receipt.save', input, async (tx) => {
        const supplier = await tx.supplier.findFirst({
          where: { ...org, id: input.supplierId, archivedAt: null },
        })
        const warehouse = await tx.warehouse.findFirst({
          where: { ...org, id: input.warehouseId, archivedAt: null },
        })
        if (!supplier || !warehouse) throw new Error('Постачальник або склад не знайдені')
        if (supplier.kind === 'SERVICES') throw new Error('Виберіть постачальника товарів')
        const products = await tx.inventoryPart.findMany({
          where: {
            ...org,
            id: { in: [...new Set(input.lines.map((l) => l.inventoryPartId))] },
            isArchived: false,
          },
          include: { brand: true },
        })
        const productsById = new Map(products.map((p) => [p.id, p]))
        const lines = []
        for (const [index, line] of input.lines.entries()) {
          const product = productsById.get(line.inventoryPartId)
          if (!product) throw new Error('Товар не знайдений')
          if (['pcs', 'шт', 'шт.'].includes(product.unit ?? 'pcs') && !D(line.quantity).isInteger())
            throw new Error('Штучний товар потребує цілої кількості')
          lines.push({
            ...meta,
            ...line,
            ...calculateLine(line),
            snapshotName: product.name,
            snapshotBrand: product.brand.name,
            snapshotArticle: product.partNumber,
            snapshotUnit: product.unit ?? 'pcs',
            sortOrder: index,
          })
        }
        const totals = {
          subtotal: lines.reduce((sum, l) => sum.plus(l.netAmount), D(0)),
          taxAmount: lines.reduce((sum, l) => sum.plus(l.taxAmount), D(0)),
          totalAmount: lines.reduce((sum, l) => sum.plus(l.totalAmount), D(0)),
        }
        const values = {
          supplierId: input.supplierId,
          targetWarehouseId: input.warehouseId,
          effectiveAt: input.effectiveAt,
          externalNumber: input.externalNumber.normalize('NFKC').toLocaleUpperCase('uk'),
          externalDate: input.externalDate,
          dueDate: input.dueDate,
          note: input.note,
          ...totals,
        }
        if (input.documentId) {
          const doc = await tx.inventoryDocument.findFirst({
            where: { ...org, id: input.documentId },
          })
          if (!doc) throw new Error('Документ не знайдений')
          if (doc.status !== 'DRAFT' || doc.kind !== 'RECEIPT')
            throw new Error('Проведений документ не можна змінювати')
          if (doc.version !== input.expectedVersion)
            throw new Error('Документ уже змінено. Оновіть сторінку')
          if (
            await tx.receiptDemandAllocation.count({
              where: { ...org, receiptLine: { documentId: doc.id } },
            })
          )
            throw new Error(
              'Перед зміною рядків зніміть розподіл приходу між нарядами. Розподіл не видаляється автоматично.'
            )
          await tx.inventoryDocumentLine.deleteMany({ where: { ...org, documentId: doc.id } })
          await tx.inventoryDocument.update({
            where: { id: doc.id },
            data: { ...values, version: { increment: 1 } },
          })
          await tx.inventoryDocumentLine.createMany({
            data: lines.map((l) => ({ ...l, documentId: doc.id })),
          })
          return {
            id: doc.id,
            version: doc.version + 1,
            status: 'DRAFT',
            total: totals.totalAmount.toFixed(2),
          }
        }
        const doc = await tx.inventoryDocument.create({
          data: {
            ...meta,
            ...values,
            number: await nextDocumentNumber(tx, ctx, 'RC', input.effectiveAt),
            kind: 'RECEIPT',
          },
        })
        await tx.inventoryDocumentLine.createMany({
          data: lines.map((l) => ({ ...l, documentId: doc.id })),
        })
        return { id: doc.id, version: 1, status: 'DRAFT', total: totals.totalAmount.toFixed(2) }
      })
    },
    async postReceipt(raw: unknown) {
      const input = postSchema.parse(raw)
      return ledgerCommand(db, ctx, 'receipt.post', input, async (tx) => {
        const doc = await tx.inventoryDocument.findFirst({
          where: { ...org, id: input.documentId },
          include: { inventoryDocumentLine_document: { orderBy: { sortOrder: 'asc' } } },
        })
        if (!doc) throw new Error('Документ не знайдений')
        if (
          doc.status !== 'DRAFT' ||
          doc.kind !== 'RECEIPT' ||
          doc.version !== input.expectedVersion
        )
          throw new Error('Документ уже проведено або змінено. Оновіть сторінку')
        await assertPeriod(tx, ctx, doc.effectiveAt, true)
        if (!doc.targetWarehouseId || !doc.supplierId)
          throw new Error('Вкажіть склад і постачальника')
        const supplier = await tx.supplier.findFirst({
          where: { ...org, id: doc.supplierId, archivedAt: null },
        })
        const warehouse = await tx.warehouse.findFirst({
          where: { ...org, id: doc.targetWarehouseId, archivedAt: null },
        })
        if (!supplier || !warehouse) throw new Error('Постачальник або склад архівовані')
        const lots = doc.inventoryDocumentLine_document.map((line) => ({
          id: randomUUID(),
          ...meta,
          inventoryPartId: line.inventoryPartId,
          sourceLineId: line.id,
          acquiredAt: doc.effectiveAt,
          unitCost: line.netAmount.div(line.quantity).toDecimalPlaces(6),
        }))
        await tx.stockLot.createMany({ data: lots })
        await tx.stockLotBalance.createMany({
          data: lots.map((lot, index) => ({
            ...meta,
            lotId: lot.id,
            warehouseId: warehouse.id,
            onHandQty: doc.inventoryDocumentLine_document[index].quantity,
          })),
        })
        await tx.inventoryLedgerEntry.createMany({
          data: lots.map((lot, index) => {
            const line = doc.inventoryDocumentLine_document[index]
            return {
              ...meta,
              lotId: lot.id,
              warehouseId: warehouse.id,
              documentLineId: line.id,
              quantityDelta: line.quantity,
              costAmountDelta: line.netAmount,
              effectiveAt: doc.effectiveAt,
              operationKey: 'receipt:' + line.id,
            }
          }),
        })
        const orders = await postReceiptProcurement(tx, ctx, doc.id)
        const party = await tx.settlementParty.findUniqueOrThrow({
          where: { organizationId_supplierId: { ...org, supplierId: supplier.id } },
        })
        if (doc.totalAmount.gt(0))
          await tx.settlementEntry.create({
            data: {
              ...meta,
              partyId: party.id,
              side: 'AP',
              polarity: 'DEBIT',
              amount: doc.totalAmount,
              effectiveAt: doc.effectiveAt,
              dueDate: doc.dueDate,
              inventoryDocumentId: doc.id,
              operationKey: 'receipt:' + doc.id,
            },
          })
        await tx.inventoryDocument.update({
          where: { id: doc.id },
          data: { status: 'POSTED', postedAt: new Date(), version: { increment: 1 } },
        })
        await refreshPurchaseOrders(tx, ctx, orders)
        return {
          id: doc.id,
          version: doc.version + 1,
          status: 'POSTED',
          total: doc.totalAmount.toFixed(2),
        }
      })
    },
    async postMoneyTransaction(raw: unknown) {
      const input = paymentSchema.parse(raw)
      return ledgerCommand(db, ctx, 'payment.post', input, async (tx) => {
        await assertPeriod(tx, ctx, input.effectiveAt, false)
        const party = await tx.settlementParty.findFirst({ where: { ...org, id: input.partyId } })
        const account = await tx.cashAccount.findFirst({
          where: { ...org, id: input.accountId, archivedAt: null },
        })
        if (!party || !account) throw new Error('Контрагент або рахунок не знайдені')
        const payment = await tx.moneyTransaction.create({
          data: {
            ...meta,
            partyId: party.id,
            accountId: account.id,
            direction: input.direction,
            amount: input.amount,
            effectiveAt: input.effectiveAt,
            method: input.method,
            note: input.note,
          },
        })
        await tx.cashLedgerEntry.create({
          data: {
            ...meta,
            accountId: account.id,
            moneyTransactionId: payment.id,
            amountDelta: D(input.amount).mul(input.direction === 'IN' ? 1 : -1),
            effectiveAt: input.effectiveAt,
            operationKey: 'payment:' + payment.id,
          },
        })
        const isCredit =
          party.kind === 'SUPPLIER' ? input.direction === 'OUT' : input.direction === 'IN'
        const entry = await tx.settlementEntry.create({
          data: {
            ...meta,
            partyId: party.id,
            side: party.kind === 'SUPPLIER' ? 'AP' : 'AR',
            polarity: isCredit ? 'CREDIT' : 'DEBIT',
            amount: input.amount,
            effectiveAt: input.effectiveAt,
            moneyTransactionId: payment.id,
            operationKey: 'payment:' + payment.id,
          },
        })
        return { id: payment.id, entryId: entry.id, amount: input.amount }
      })
    },
    async allocateSettlement(raw: unknown) {
      const input = allocationSchema.parse(raw)
      return ledgerCommand(db, ctx, 'settlement.allocate', input, async (tx) => {
        await assertPeriod(tx, ctx, input.effectiveAt, false)
        const debit = await tx.settlementEntry.findFirst({
          where: { ...org, id: input.debitEntryId, polarity: 'DEBIT' },
        })
        const credit = await tx.settlementEntry.findFirst({
          where: { ...org, id: input.creditEntryId, polarity: 'CREDIT' },
        })
        if (!debit || !credit) throw new Error('Документ розрахунків не знайдений')
        if (
          debit.partyId !== credit.partyId ||
          debit.side !== credit.side ||
          debit.currency !== credit.currency
        )
          throw new Error('Не можна рознести оплату між різними контрагентами')
        if (input.effectiveAt < debit.effectiveAt || input.effectiveAt < credit.effectiveAt)
          throw new Error('Дата рознесення не може передувати документам')
        for (const entry of [debit, credit]) {
          const used = await allocated(tx, ctx, entry.id, entry.polarity)
          if (D(input.amount).gt(entry.amount.minus(used)))
            throw new Error('Сума перевищує нерознесений залишок')
        }
        const allocation = await tx.settlementAllocation.create({
          data: {
            ...meta,
            debitEntryId: debit.id,
            creditEntryId: credit.id,
            amount: input.amount,
            effectiveAt: input.effectiveAt,
            operationKey: input.idempotencyKey,
          },
        })
        return { id: allocation.id, amount: input.amount }
      })
    },
  }
}
export async function allocated(tx: Tx, ctx: LedgerContext, id: string, polarity: string) {
  const sum = await tx.settlementAllocation.aggregate({
    where: {
      organizationId: ctx.organizationId,
      reversedAt: null,
      ...(polarity === 'DEBIT' ? { debitEntryId: id } : { creditEntryId: id }),
    },
    _sum: { amount: true },
  })
  return sum._sum.amount ?? D(0)
}
