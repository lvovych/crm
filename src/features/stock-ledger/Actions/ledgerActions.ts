'use server'
import { reverseReceipt } from '../Lib/reverseReceipt'
import { commitImport, importPage } from '../Lib/importService'
import { createStockAdjustments } from '../Lib/adjustments'
import { createFinance } from '../Lib/finance'
import { reconciliation, csvCell } from '../Lib/reconciliation'
import { createProcurement } from '../Lib/procurement'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { PermissionAction as A, PermissionSubject as S } from '@/lib/permissions'
import { createStockOperations } from '../Lib/stock'
import { createSettlementOperations } from '../Lib/settlements'
import { returnToSupplier } from '../Lib/supplierReturns'
import { createStockLedger } from '../Lib/service'
import { D } from '../Lib/amounts'
import type { LedgerDB } from '../Lib/transaction'
// The realtime extension preserves Prisma's transaction API and native delegates.
const ledgerDB = db as unknown as LedgerDB

function enabled() {
  if (process.env.STOCK_LEDGER_ENABLED !== 'true')
    throw new Error('Новий складський облік ще не ввімкнений')
}
const permission = (action: A, subject: S) => ({ action, subject })
const stockRead = [permission(A.READ, S.STOCK_LEDGER), permission(A.READ, S.STOCK_COST)]
const draft = [...stockRead, permission(A.CREATE, S.STOCK_LEDGER)]
export async function saveSupplier(input: unknown) {
  return withAuth(async (ctx) => {
    enabled()
    if (!ctx.isAdmin) throw new Error('Довідники змінює адміністратор')
    return createStockLedger(ledgerDB, ctx).createSupplier(input)
  })
}
export async function saveWarehouse(input: unknown) {
  return withAuth(async (ctx) => {
    enabled()
    if (!ctx.isAdmin) throw new Error('Довідники змінює адміністратор')
    return createStockLedger(ledgerDB, ctx).createWarehouse(input)
  })
}
export async function saveCashAccount(input: unknown) {
  return withAuth(async (ctx) => {
    enabled()
    if (!ctx.isAdmin) throw new Error('Рахунки створює адміністратор')
    return createStockLedger(ledgerDB, ctx).createAccount(input)
  })
}
export async function saveReceipt(input: unknown) {
  return withAuth(
    async (ctx) => {
      enabled()
      return createStockLedger(ledgerDB, ctx).saveReceiptDraft(input)
    },
    { requiredPermissions: draft }
  )
}
export async function postReceipt(input: unknown) {
  return withAuth(
    async (ctx) => {
      enabled()
      return createStockLedger(ledgerDB, ctx).postReceipt(input)
    },
    { requiredPermissions: [...stockRead, permission(A.MANAGE, S.STOCK_LEDGER)] }
  )
}
export async function postSupplierPayment(input: unknown) {
  return withAuth(
    async (ctx) => {
      enabled()
      return createStockLedger(ledgerDB, ctx).postMoneyTransaction(input)
    },
    { requiredPermissions: [permission(A.CREATE, S.SUPPLIER_FINANCE)] }
  )
}
export async function allocateSupplierPayment(input: unknown) {
  return withAuth(
    async (ctx) => {
      enabled()
      return createStockLedger(ledgerDB, ctx).allocateSettlement(input)
    },
    { requiredPermissions: [permission(A.MANAGE, S.SUPPLIER_FINANCE)] }
  )
}
export async function getLedgerDirectory() {
  return withAuth(
    async (ctx) => {
      enabled()
      const where = { organizationId: ctx.organizationId, archivedAt: null }
      const [suppliers, warehouses] = await Promise.all([
        db.supplier.findMany({ where, orderBy: { name: 'asc' }, take: 500 }),
        db.warehouse.findMany({ where, orderBy: { name: 'asc' }, take: 100 }),
      ])
      return { suppliers, warehouses, isAdmin: ctx.isAdmin }
    },
    { requiredPermissions: stockRead }
  )
}
export async function searchLedgerProducts(search: string) {
  return withAuth(
    async (ctx) => {
      enabled()
      const term = z.string().trim().min(1).max(100).parse(search)
      return db.inventoryPart.findMany({
        where: {
          organizationId: ctx.organizationId,
          isArchived: false,
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { partNumber: { contains: term, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          name: true,
          partNumber: true,
          brand: { select: { name: true } },
          unit: true,
        },
        take: 20,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      })
    },
    { requiredPermissions: stockRead }
  )
}
export async function listLedgerDocuments(raw: { page?: number; search?: string }) {
  return withAuth(
    async (ctx) => {
      enabled()
      const input = z
        .object({
          page: z.number().int().min(1).default(1),
          search: z.string().max(100).default(''),
        })
        .parse(raw)
      const where = {
        organizationId: ctx.organizationId,
        ...(input.search
          ? {
              OR: [
                { number: { contains: input.search, mode: 'insensitive' as const } },
                { externalNumber: { contains: input.search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      }
      const [rows, total] = await Promise.all([
        db.inventoryDocument.findMany({
          where,
          include: {
            supplier: { select: { name: true } },
            targetWarehouse: { select: { name: true } },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (input.page - 1) * 25,
          take: 25,
        }),
        db.inventoryDocument.count({ where }),
      ])
      return {
        rows: rows.map((r) => ({
          ...r,
          subtotal: r.subtotal.toFixed(2),
          taxAmount: r.taxAmount.toFixed(2),
          totalAmount: r.totalAmount.toFixed(2),
        })),
        total,
      }
    },
    { requiredPermissions: stockRead }
  )
}
export async function getLedgerDocument(id: string) {
  return withAuth(
    async (ctx) => {
      enabled()
      const doc = await db.inventoryDocument.findFirst({
        where: { organizationId: ctx.organizationId, id },
        include: {
          inventoryDocumentLine_document: {
            orderBy: { sortOrder: 'asc' },
            include: { receiptDemandAllocation_receiptLine: true },
          },
        },
      })
      if (!doc) throw new Error('Документ не знайдений')
      return JSON.parse(JSON.stringify(doc)) as {
        id: string
        number: string
        status: string
        version: number
        supplierId: string
        targetWarehouseId: string
        effectiveAt: string
        externalNumber: string
        externalDate: string
        dueDate: string
        note: string
        totalAmount: string
        inventoryDocumentLine_document: Array<{
          id: string
          purchaseOrderLineId: string | null
          receiptDemandAllocation_receiptLine: Array<{
            receiptLineId: string
            demandId: string
            quantity: string
            purchaseAllocationId: string | null
          }>
          inventoryPartId: string
          snapshotName: string
          snapshotBrand: string
          snapshotArticle: string | null
          quantity: string
          unitPrice: string
          discountType: 'NONE' | 'PERCENT' | 'AMOUNT'
          discountValue: string
          taxMode: 'NONE' | 'INCLUSIVE' | 'EXCLUSIVE'
          taxRate: string
          totalAmount: string
        }>
      }
    },
    { requiredPermissions: stockRead }
  )
}
export async function listLedgerStock(page = 1) {
  return withAuth(
    async (ctx) => {
      enabled()
      z.number().int().positive().parse(page)
      const where = { organizationId: ctx.organizationId }
      const [rows, total] = await Promise.all([
        db.stockLotBalance.findMany({
          where,
          include: {
            warehouse: { select: { name: true } },
            lot: {
              include: {
                inventoryPart: {
                  select: { name: true, partNumber: true, brand: { select: { name: true } } },
                },
              },
            },
          },
          orderBy: { id: 'asc' },
          skip: (page - 1) * 25,
          take: 25,
        }),
        db.stockLotBalance.count({ where }),
      ])
      return {
        rows: rows.map((r) => ({
          id: r.id,
          lotId: r.lotId,
          warehouseId: r.warehouseId,
          version: r.version,
          warehouse: r.warehouse.name,
          name: r.lot.inventoryPart.name,
          article: r.lot.inventoryPart.partNumber,
          brand: r.lot.inventoryPart.brand.name,
          onHand: r.onHandQty.toFixed(3),
          reserved: r.reservedQty.toFixed(3),
          available: r.onHandQty.minus(r.reservedQty).toFixed(3),
        })),
        total,
      }
    },
    { requiredPermissions: [permission(A.READ, S.STOCK_LEDGER)] }
  )
}
export async function getSupplierFinances(partyId?: string) {
  return withAuth(
    async (ctx) => {
      enabled()
      const org = { organizationId: ctx.organizationId }
      const [parties, accounts] = await Promise.all([
        db.settlementParty.findMany({
          where: { ...org, kind: 'SUPPLIER' },
          orderBy: { displayNameSnapshot: 'asc' },
          take: 500,
        }),
        db.cashAccount.findMany({ where: { ...org, archivedAt: null }, orderBy: { name: 'asc' } }),
      ])
      const selected = partyId ? parties.find((p) => p.id === partyId) : parties[0]
      if (partyId && !selected) throw new Error('Постачальник не знайдений')
      const entries = selected
        ? await db.settlementEntry.findMany({
            where: { ...org, partyId: selected.id },
            include: {
              settlementAllocation_debitEntry: { where: { reversedAt: null } },
              settlementAllocation_creditEntry: { where: { reversedAt: null } },
              inventoryDocument: { select: { number: true, externalNumber: true } },
              supplierServiceDocument: { select: { number: true, externalNumber: true } },
              moneyTransaction: { select: { status: true, reversalOfId: true } },
            },
            orderBy: [{ effectiveAt: 'asc' }, { id: 'asc' }],
          })
        : []
      const rows = entries.map((e) => {
        const allocations =
          e.polarity === 'DEBIT'
            ? e.settlementAllocation_debitEntry
            : e.settlementAllocation_creditEntry
        const paid = allocations.reduce((s, a) => s.plus(a.amount), D(0))
        return {
          id: e.id,
          polarity: e.polarity,
          amount: e.amount.toFixed(2),
          allocated: paid.toFixed(2),
          remaining: e.amount.minus(paid).toFixed(2),
          date: e.effectiveAt.toISOString().slice(0, 10),
          dueDate: e.dueDate?.toISOString().slice(0, 10),
          paymentId:
            e.moneyTransaction?.status === 'POSTED' && !e.moneyTransaction.reversalOfId
              ? e.moneyTransactionId
              : null,
          allocations: allocations.map((a) => ({ id: a.id, amount: a.amount.toFixed(2) })),
          label:
            e.inventoryDocument?.externalNumber ??
            e.inventoryDocument?.number ??
            e.supplierServiceDocument?.externalNumber ??
            (e.openingBalanceId ? 'Початковий баланс' : 'Оплата / повернення'),
        }
      })
      return {
        parties,
        accounts,
        selectedPartyId: selected?.id,
        rows,
        debt: rows
          .filter((e) => e.polarity === 'DEBIT')
          .reduce((s, e) => s.plus(e.remaining), D(0))
          .toFixed(2),
        advance: rows
          .filter((e) => e.polarity === 'CREDIT')
          .reduce((s, e) => s.plus(e.remaining), D(0))
          .toFixed(2),
      }
    },
    { requiredPermissions: [permission(A.READ, S.SUPPLIER_FINANCE)] }
  )
}

export async function listLedgerDemands(
  search = '',
  filter: { serviceRecordId?: string; servicePartId?: string } = {}
) {
  return withAuth(
    async (ctx) => {
      enabled()
      z.string().max(100).parse(search)
      const scope = z
        .object({
          serviceRecordId: z.string().min(1).optional(),
          servicePartId: z.string().min(1).optional(),
        })
        .parse(filter)
      const rows = await db.servicePart.findMany({
        where: {
          serviceRecord: {
            organizationId: ctx.organizationId,
            inventoryAccountingMode: 'LEDGER',
            ...(scope.serviceRecordId ? { id: scope.serviceRecordId } : {}),
            ...(search
              ? {
                  OR: [
                    { invoiceNumber: { contains: search, mode: 'insensitive' as const } },
                    { title: { contains: search, mode: 'insensitive' as const } },
                  ],
                }
              : {}),
          },
          inventoryPartId: { not: null },
          ...(scope.servicePartId ? { id: scope.servicePartId } : {}),
        },
        include: {
          serviceRecord: { select: { invoiceNumber: true, title: true } },
          stockDemand_servicePart: {
            include: {
              stockReservation_demand: true,
              purchaseDemandAllocation_demand: {
                include: { purchaseOrderLine: { include: { order: true } } },
              },
              documentLotAllocation_demand: {
                include: {
                  documentLine: { include: { document: { select: { kind: true } } } },
                },
              },
            },
          },
        },
        take: scope.serviceRecordId ? 500 : 50,
        orderBy: { id: 'asc' },
      })
      return rows.map((p) => {
        const d = p.stockDemand_servicePart[0]
        const issued =
          d?.documentLotAllocation_demand.reduce(
            (s, a) => s.plus(a.quantity.mul(a.documentLine.document.kind === 'ISSUE' ? 1 : -1)),
            D(0)
          ) ?? D(0)
        return {
          servicePartId: p.id,
          inventoryPartId: p.inventoryPartId!,
          demandId: d?.id,
          name: p.name,
          job: p.serviceRecord.invoiceNumber ?? p.serviceRecord.title,
          stockOwnership: p.stockOwnership,
          customerPartInstalled: p.customerPartInstalled,
          quantity: String(p.quantity),
          expected:
            d?.purchaseDemandAllocation_demand
              .filter((a) =>
                ['CONFIRMED', 'PARTIALLY_RECEIVED'].includes(a.purchaseOrderLine.order.status)
              )
              .reduce((sum, a) => sum.plus(a.quantity.minus(a.fulfilledQty)), D(0))
              .toString() ?? '0',
          issued: issued.toString(),
          reserved:
            d?.stockReservation_demand
              .reduce((s, r) => s.plus(r.remainingQuantity), D(0))
              .toString() ?? '0',
          reservations:
            d?.stockReservation_demand
              .filter((r) => r.remainingQuantity.gt(0))
              .map((r) => ({ id: r.id, quantity: r.remainingQuantity.toString() })) ?? [],
          issues:
            d?.documentLotAllocation_demand
              .filter((a) => a.documentLine.document.kind === 'ISSUE')
              .map((a) => ({ id: a.id, quantity: a.quantity.toString() })) ?? [],
        }
      })
    },
    { requiredPermissions: [permission(A.READ, S.STOCK_LEDGER)] }
  )
}

export async function stockOperation(
  operation:
    | 'demand'
    | 'cancelDemand'
    | 'reserve'
    | 'release'
    | 'issue'
    | 'return'
    | 'transfer'
    | 'supplierReturn',
  input: unknown
) {
  return withAuth(
    async (ctx) => {
      enabled()
      const service = createStockOperations(ledgerDB, ctx)
      switch (operation) {
        case 'demand':
          return service.createDemand(input)
        case 'cancelDemand':
          return service.cancelDemand(input)
        case 'reserve':
          return service.reserve(input)
        case 'release':
          return service.release(input)
        case 'issue':
          return service.issue(input)
        case 'return':
          return service.returnFromWorkOrder(input)
        case 'transfer':
          return service.transfer(input)
        case 'supplierReturn':
          return returnToSupplier(ledgerDB, ctx, input)
        default:
          throw new Error('Невідома операція')
      }
    },
    {
      requiredPermissions: [permission(A.MANAGE, S.STOCK_LEDGER), permission(A.READ, S.STOCK_COST)],
    }
  )
}
export async function reverseLedgerPayment(input: unknown) {
  return withAuth(async (ctx) => {
    enabled()
    if (!ctx.isAdmin) throw new Error('Сторно доступне адміністратору')
    return createSettlementOperations(ledgerDB, ctx).reversePayment(input)
  })
}
export async function reverseLedgerAllocation(input: unknown) {
  return withAuth(
    async (ctx) => {
      enabled()
      return createSettlementOperations(ledgerDB, ctx).reverseAllocation(input)
    },
    { requiredPermissions: [permission(A.MANAGE, S.SUPPLIER_FINANCE)] }
  )
}

export async function purchaseOperation(
  operation: 'save' | 'confirm' | 'cancel' | 'allocateReceipt',
  input: unknown
) {
  return withAuth(
    async (ctx) => {
      enabled()
      const service = createProcurement(ledgerDB, ctx)
      switch (operation) {
        case 'save':
          return service.saveDraft(input)
        case 'confirm':
          return service.confirm(input)
        case 'cancel':
          return service.cancelRemainder(input)
        case 'allocateReceipt':
          return service.allocateReceipt(input)
        default:
          throw new Error('Невідома операція')
      }
    },
    { requiredPermissions: draft }
  )
}
export async function listPurchaseOrders(page = 1) {
  return withAuth(
    async (ctx) => {
      enabled()
      z.number().int().positive().parse(page)
      const rows = await db.purchaseOrder.findMany({
        where: { organizationId: ctx.organizationId },
        include: {
          supplier: { select: { name: true } },
          warehouse: { select: { name: true } },
          purchaseOrderLine_order: {
            include: {
              inventoryDocumentLine_purchaseOrderLine: {
                where: { document: { status: 'POSTED', kind: 'RECEIPT' } },
                select: { quantity: true },
              },
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * 25,
        take: 25,
      })
      return rows.map((o) => ({
        id: o.id,
        number: o.number,
        status: o.status,
        version: o.version,
        supplierId: o.supplierId,
        supplier: o.supplier.name,
        warehouseId: o.warehouseId,
        warehouse: o.warehouse.name,
        lines: o.purchaseOrderLine_order.map((l) => ({
          id: l.id,
          inventoryPartId: l.inventoryPartId,
          name: l.snapshotName,
          brand: l.snapshotBrand,
          article: l.snapshotArticle,
          ordered: l.qtyOrdered.toString(),
          cancelled: l.qtyCancelled.toString(),
          received: l.inventoryDocumentLine_purchaseOrderLine
            .reduce((s, r) => s.plus(r.quantity), D(0))
            .toString(),
          unitPrice: l.quotedUnitPrice.toString(),
        })),
      }))
    },
    { requiredPermissions: stockRead }
  )
}

export async function postOpeningStock(input: unknown) {
  return withAuth(async (ctx) => {
    enabled()
    if (!ctx.isAdmin) throw new Error('Початкові залишки вносить адміністратор')
    return createStockAdjustments(ledgerDB, ctx).opening(input)
  })
}
export async function postStockCountAdjustment(input: unknown) {
  return withAuth(async (ctx) => {
    enabled()
    if (!ctx.isAdmin) throw new Error('Коригування проводить адміністратор')
    return createStockAdjustments(ledgerDB, ctx).adjust(input)
  })
}
export async function postSubcontract(input: unknown) {
  return withAuth(
    async (ctx) => {
      enabled()
      return createFinance(ledgerDB, ctx).postSubcontract(input)
    },
    { requiredPermissions: [permission(A.CREATE, S.SUPPLIER_FINANCE)] }
  )
}
export async function postOpeningBalance(input: unknown) {
  return withAuth(async (ctx) => {
    enabled()
    if (!ctx.isAdmin) throw new Error('Початкові баланси вносить адміністратор')
    return createFinance(ledgerDB, ctx).openingBalance(input)
  })
}
export async function getLedgerReconciliation() {
  return withAuth(async (ctx) => {
    enabled()
    if (!ctx.isAdmin) throw new Error('Звірку виконує адміністратор')
    return db.$transaction(
      (tx) => reconciliation(tx as unknown as import('../Lib/transaction').Tx, ctx),
      { isolationLevel: 'RepeatableRead' }
    )
  })
}
export async function getLedgerStatement(input: { partyId: string; through: string }) {
  return withAuth(
    async (ctx) => {
      enabled()
      const parsed = z.object({ partyId: z.string().min(1), through: z.iso.date() }).parse(input)
      const through = new Date(parsed.through + 'T23:59:59.999Z')
      const party = await db.settlementParty.findFirst({
        where: { organizationId: ctx.organizationId, id: parsed.partyId },
      })
      if (!party) throw new Error('Контрагент не знайдений')
      const entries = await db.settlementEntry.findMany({
        where: {
          organizationId: ctx.organizationId,
          partyId: party.id,
          effectiveAt: { lte: through },
        },
        include: {
          settlementAllocation_debitEntry: {
            where: {
              effectiveAt: { lte: through },
              OR: [{ reversedAt: null }, { reversedAt: { gt: through } }],
            },
          },
          settlementAllocation_creditEntry: {
            where: {
              effectiveAt: { lte: through },
              OR: [{ reversedAt: null }, { reversedAt: { gt: through } }],
            },
          },
        },
        orderBy: [{ effectiveAt: 'asc' }, { id: 'asc' }],
      })
      const rows = entries.map((e) => ({
        id: e.id,
        date: e.effectiveAt.toISOString().slice(0, 10),
        polarity: e.polarity,
        amount: e.amount.toFixed(2),
        remaining: e.amount
          .minus(
            (e.polarity === 'DEBIT'
              ? e.settlementAllocation_debitEntry
              : e.settlementAllocation_creditEntry
            ).reduce((s, a) => s.plus(a.amount), D(0))
          )
          .toFixed(2),
      }))
      const csv = [
        ['Контрагент', 'Дата', 'Тип', 'Сума', 'Залишок'].map(csvCell).join(';'),
        ...rows.map((r) =>
          [
            party.displayNameSnapshot,
            r.date,
            r.polarity === 'DEBIT' ? 'Нарахування' : 'Оплата / кредит',
            r.amount,
            r.remaining,
          ]
            .map(csvCell)
            .join(';')
        ),
      ].join('\r\n')
      return {
        rows,
        csv,
        debt: rows
          .filter((r) => r.polarity === 'DEBIT')
          .reduce((s, r) => s.plus(r.remaining), D(0))
          .toFixed(2),
        advance: rows
          .filter((r) => r.polarity === 'CREDIT')
          .reduce((s, r) => s.plus(r.remaining), D(0))
          .toFixed(2),
      }
    },
    { requiredPermissions: [permission(A.READ, S.SUPPLIER_FINANCE)] }
  )
}

export async function getImportPreview(jobId: string, page = 1) {
  return withAuth(
    async (ctx) => {
      enabled()
      z.number().int().positive().parse(page)
      const job = await db.ledgerImportJob.findFirst({
        where: { organizationId: ctx.organizationId, id: jobId },
      })
      if (!job) throw new Error('Імпорт не знайдений')
      return { ...importPage(job.mapping, page), documentId: job.documentId }
    },
    { requiredPermissions: draft }
  )
}
export async function commitImportDraft(input: unknown) {
  return withAuth(
    async (ctx) => {
      enabled()
      return commitImport(ledgerDB, ctx, input)
    },
    { requiredPermissions: draft }
  )
}

export async function reverseLedgerReceipt(input: unknown) {
  return withAuth(async (ctx) => {
    enabled()
    if (!ctx.isAdmin) throw new Error('Сторно приходу доступне адміністратору')
    return reverseReceipt(ledgerDB, ctx, input)
  })
}
