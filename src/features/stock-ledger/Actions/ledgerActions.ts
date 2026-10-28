'use server'
import { reverseReceipt } from '../Lib/reverseReceipt'
import { commitImport, importPage } from '../Lib/importService'
import { createStockAdjustments } from '../Lib/adjustments'
import { createFinance } from '../Lib/finance'
import { fullReconciliation, csvCell } from '../Lib/reconciliation'
import { createProcurement } from '../Lib/procurement'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withLedgerAuth as withAuth } from '../Lib/auth.server'
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
    { requiredPermissions: [...stockRead, permission(A.POST, S.STOCK_LEDGER)] }
  )
}
export async function postSupplierPayment(input: unknown) {
  return withAuth(
    async (ctx) => {
      enabled()
      return createStockLedger(ledgerDB, ctx).postMoneyTransaction(input)
    },
    { requiredPermissions: [permission(A.POST, S.SUPPLIER_FINANCE)] }
  )
}
export async function allocateSupplierPayment(input: unknown) {
  return withAuth(
    async (ctx) => {
      enabled()
      return createStockLedger(ledgerDB, ctx).allocateSettlement(input)
    },
    { requiredPermissions: [permission(A.ALLOCATE, S.SUPPLIER_FINANCE)] }
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
    { requiredPermissions: [permission(A.READ, S.STOCK_LEDGER)] }
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
    { requiredPermissions: [permission(A.READ, S.STOCK_LEDGER)] }
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
          additionalCost: r.additionalCost.toFixed(2),
          roundingAdjustment: r.roundingAdjustment.toFixed(2),
          sourceTotal: r.sourceTotal?.toFixed(2) ?? null,
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
      const original = await db.ledgerImportTask.findFirst({
        where: {
          organizationId: ctx.organizationId,
          status: 'READY',
          previewJob: { documentId: doc.id },
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      })
      return JSON.parse(JSON.stringify({ ...doc, originalImportId: original?.id ?? null })) as {
        originalImportId: string | null
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
        additionalCost: string
        roundingAdjustment: string
        roundingReason: string
        sourceTotal: string | null
        costAllocationMethod: string
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
          additionalCostAmount: string
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
  filter: { serviceRecordId?: string; servicePartId?: string; page?: number } = {}
) {
  return withAuth(
    async (ctx) => {
      enabled()
      z.string().max(100).parse(search)
      const scope = z
        .object({
          serviceRecordId: z.string().min(1).optional(),
          servicePartId: z.string().min(1).optional(),
          page: z.number().int().min(1).max(100000).default(1),
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
                    { customer: { name: { contains: search, mode: 'insensitive' as const } } },
                    {
                      vehicle: { licensePlate: { contains: search, mode: 'insensitive' as const } },
                    },
                  ],
                }
              : {}),
          },
          inventoryPartId: { not: null },
          ...(scope.servicePartId ? { id: scope.servicePartId } : {}),
        },
        include: {
          serviceRecord: {
            select: {
              invoiceNumber: true,
              title: true,
              customer: { select: { name: true } },
              vehicle: { select: { licensePlate: true } },
            },
          },
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
        skip: (scope.page - 1) * 50,
        take: 50,
        orderBy: { id: 'asc' },
      })
      const products = await db.inventoryPart.findMany({
        where: {
          organizationId: ctx.organizationId,
          id: { in: rows.map((p) => p.inventoryPartId!) },
        },
        select: {
          id: true,
          trackingMode: true,
          supplierProducts: {
            where: { preferred: true, archivedAt: null, supplier: { archivedAt: null } },
            take: 1,
            select: { supplierId: true, leadTimeDays: true, supplier: { select: { name: true } } },
          },
        },
      })
      const trackingModes = new Map(products.map((p) => [p.id, p.trackingMode]))
      return rows.map((p) => {
        const d = p.stockDemand_servicePart[0]
        const issued =
          d?.documentLotAllocation_demand.reduce(
            (s, a) =>
              s.plus(
                a.quantity.mul(
                  ['ISSUE', 'MIGRATION_ISSUE'].includes(a.documentLine.document.kind) ? 1 : -1
                )
              ),
            D(0)
          ) ?? D(0)
        return {
          servicePartId: p.id,
          inventoryPartId: p.inventoryPartId!,
          demandId: d?.id,
          name: p.name,
          job: p.serviceRecord.invoiceNumber ?? p.serviceRecord.title,
          customerName: p.serviceRecord.customer?.name ?? '',
          licensePlate: p.serviceRecord.vehicle?.licensePlate ?? '',
          trackingMode: trackingModes.get(p.inventoryPartId!) ?? 'STOCK',
          preferredSupplier:
            products.find((product) => product.id === p.inventoryPartId)?.supplierProducts[0] ??
            null,
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
              .filter((a) => ['ISSUE', 'MIGRATION_ISSUE'].includes(a.documentLine.document.kind))
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
        case 'issue': {
          const result = await service.issue(input)
          return { id: result.id, quantity: result.quantity }
        }
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
      requiredPermissions: [
        permission(
          ['demand', 'cancelDemand'].includes(operation)
            ? A.CREATE
            : ['reserve', 'release'].includes(operation)
              ? A.RESERVE
              : A.ISSUE,
          S.STOCK_LEDGER
        ),
        permission(A.READ, S.STOCK_LEDGER),
        ...(operation === 'supplierReturn' ? [permission(A.READ, S.STOCK_COST)] : []),
      ],
    }
  )
}
export async function reverseLedgerPayment(input: unknown) {
  return withAuth(
    async (ctx) => {
      enabled()
      return createSettlementOperations(ledgerDB, ctx).reversePayment(input)
    },
    {
      requiredPermissions: [
        permission(A.REVERSE, S.SUPPLIER_FINANCE),
        permission(A.READ, S.SUPPLIER_FINANCE),
      ],
    }
  )
}
export async function reverseLedgerAllocation(input: unknown) {
  return withAuth(
    async (ctx) => {
      enabled()
      return createSettlementOperations(ledgerDB, ctx).reverseAllocation(input)
    },
    { requiredPermissions: [permission(A.ALLOCATE, S.SUPPLIER_FINANCE)] }
  )
}

export async function purchaseOperation(
  operation: 'save' | 'confirm' | 'cancel' | 'allocateReceipt' | 'amend',
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
        case 'amend':
          return service.amendQuantity(input)
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
    { requiredPermissions: [permission(A.POST, S.SUPPLIER_FINANCE)] }
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
      (tx) => fullReconciliation(tx as unknown as import('../Lib/transaction').Tx, ctx),
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
      z.object({ expectedRevision: z.string().regex(/^[a-f0-9]{64}$/) }).parse(input)
      return commitImport(ledgerDB, ctx, input)
    },
    { requiredPermissions: draft }
  )
}

export async function reverseLedgerReceipt(input: unknown) {
  return withAuth(
    async (ctx) => {
      enabled()
      return reverseReceipt(ledgerDB, ctx, input)
    },
    {
      requiredPermissions: [
        permission(A.REVERSE, S.STOCK_LEDGER),
        permission(A.READ, S.STOCK_COST),
      ],
    }
  )
}

export async function listManagedDirectories() {
  return withAuth(async (ctx) => {
    enabled()
    if (!ctx.isAdmin) throw new Error('Довідники змінює адміністратор')
    const where = { organizationId: ctx.organizationId }
    const [suppliers, warehouses, accounts] = await Promise.all([
      db.supplier.findMany({ where, orderBy: { name: 'asc' } }),
      db.warehouse.findMany({ where, orderBy: { name: 'asc' } }),
      db.cashAccount.findMany({ where, orderBy: { name: 'asc' } }),
    ])
    return { suppliers, warehouses, accounts }
  })
}
export async function updateLedgerDirectory(
  kind: 'supplier' | 'warehouse' | 'account',
  input: unknown
) {
  return withAuth(async (ctx) => {
    enabled()
    if (!ctx.isAdmin) throw new Error('Довідники змінює адміністратор')
    const { directoryOperations } = await import('../Lib/directories')
    const operation = z.enum(['supplier', 'warehouse', 'account']).parse(kind)
    return directoryOperations(ledgerDB, ctx)[operation](input)
  })
}
export async function getStockSummary(input: unknown) {
  return withAuth(
    async (ctx) => {
      enabled()
      const { stockSummary } = await import('../Lib/stockReports')
      return ledgerDB.$transaction((tx) => stockSummary(tx, ctx, input), {
        isolationLevel: 'RepeatableRead',
      })
    },
    { requiredPermissions: [permission(A.READ, S.STOCK_LEDGER)] }
  )
}
export async function getStockHistory(input: unknown) {
  return withAuth(
    async (ctx) => {
      enabled()
      const { stockHistory } = await import('../Lib/stockReports')
      return ledgerDB.$transaction((tx) => stockHistory(tx, ctx, input), {
        isolationLevel: 'RepeatableRead',
      })
    },
    { requiredPermissions: [permission(A.READ, S.STOCK_LEDGER)] }
  )
}
export async function getStockWarehouses() {
  return withAuth(
    async (ctx) => {
      enabled()
      return db.warehouse.findMany({
        where: { organizationId: ctx.organizationId },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      })
    },
    { requiredPermissions: [permission(A.READ, S.STOCK_LEDGER)] }
  )
}
export async function closeAccountingPeriod(input: unknown) {
  return withAuth(async (ctx) => {
    enabled()
    if (!ctx.isAdmin) throw new Error('Періоди закриває адміністратор')
    const { closeLedgerPeriod } = await import('../Lib/administration')
    return closeLedgerPeriod(ledgerDB, ctx, input)
  })
}
export async function getLedgerAdministration(page = 1) {
  return withAuth(async (ctx) => {
    enabled()
    if (!ctx.isAdmin) throw new Error('Доступ лише для адміністратора')
    const p = z.number().int().min(1).max(100000).parse(page),
      where = { organizationId: ctx.organizationId }
    const [parties, accounts, warehouses, period, audit, total] = await Promise.all([
      db.settlementParty.findMany({
        where,
        select: { id: true, kind: true, displayNameSnapshot: true },
        orderBy: { displayNameSnapshot: 'asc' },
      }),
      db.cashAccount.findMany({
        where: { ...where, archivedAt: null },
        select: { id: true, name: true },
      }),
      db.warehouse.findMany({
        where: { ...where, archivedAt: null },
        select: { id: true, name: true },
      }),
      db.accountingPeriodLock.findUnique({ where }),
      db.ledgerAuditEvent.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (p - 1) * 25,
        take: 25,
        select: {
          id: true,
          createdAt: true,
          createdById: true,
          action: true,
          entityId: true,
          payload: true,
        },
      }),
      db.ledgerAuditEvent.count({ where }),
    ])
    const diagnostic = await db.appSetting.findUnique({
      where: {
        organizationId_key: {
          organizationId: ctx.organizationId,
          key: 'stockLedger.lastDiagnostic.v1',
        },
      },
      select: { value: true },
    })
    return {
      parties,
      accounts,
      warehouses,
      period,
      audit,
      total,
      diagnostic: diagnostic
        ? (JSON.parse(diagnostic.value) as { checkedAt: string; count: number })
        : null,
    }
  })
}
export async function getFinancialReport(input: unknown) {
  return withAuth(
    async (ctx) => {
      enabled()
      const { financialReport } = await import('../Lib/financialReport')
      return ledgerDB.$transaction((tx) => financialReport(tx, ctx, input), {
        isolationLevel: 'RepeatableRead',
      })
    },
    {
      requiredPermissions: [
        permission(A.READ, S.SUPPLIER_FINANCE),
        permission(A.READ, S.STOCK_COST),
      ],
    }
  )
}
export async function stockCountCommand(
  operation: 'start' | 'save' | 'post' | 'cancel',
  input: unknown
) {
  return withAuth(
    async (ctx) => {
      enabled()
      const { stockCountOperations } = await import('../Lib/stockCount')
      return stockCountOperations(ledgerDB, ctx)[
        z.enum(['start', 'save', 'post', 'cancel']).parse(operation)
      ](input)
    },
    {
      requiredPermissions: [permission(A.ADJUST, S.STOCK_LEDGER), permission(A.READ, S.STOCK_COST)],
    }
  )
}
export async function listStockCounts(page = 1) {
  return withAuth(
    async (ctx) => {
      enabled()
      const p = z.number().int().positive().parse(page),
        where = { organizationId: ctx.organizationId }
      return {
        rows: await db.ledgerStockCount.findMany({
          where,
          include: { warehouse: { select: { name: true } } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (p - 1) * 25,
          take: 25,
        }),
        total: await db.ledgerStockCount.count({ where }),
      }
    },
    { requiredPermissions: stockRead }
  )
}
export async function getStockCount(id: string) {
  return withAuth(
    async (ctx) => {
      enabled()
      const row = await db.ledgerStockCount.findFirstOrThrow({
        where: { organizationId: ctx.organizationId, id },
        include: {
          warehouse: { select: { name: true } },
          lines: {
            include: {
              inventoryPart: {
                select: {
                  name: true,
                  partNumber: true,
                  brand: { select: { name: true } },
                  unit: true,
                },
              },
            },
          },
          adjustmentDocument: { select: { number: true } },
        },
      })
      return {
        ...row,
        lines: row.lines.map((l) => ({
          ...l,
          expectedQty: l.expectedQty.toString(),
          countedQty: l.countedQty?.toString() ?? null,
          confirmedUnitCost: l.confirmedUnitCost?.toString() ?? null,
        })),
      }
    },
    { requiredPermissions: stockRead }
  )
}

export async function resolveLedgerImportRow(input: unknown) {
  return withAuth(
    async (ctx) => {
      enabled()
      const { resolveImportRow } = await import('../Lib/importService')
      return resolveImportRow(ledgerDB, ctx, input)
    },
    { requiredPermissions: draft }
  )
}

export async function getWorkSubcontracts(serviceRecordId: string, serviceLaborId: string) {
  return withAuth(
    async (ctx) => {
      enabled()
      await db.serviceRecord.findFirstOrThrow({
        where: { id: serviceRecordId, organizationId: ctx.organizationId },
      })
      const work = await db.serviceLabor.findFirstOrThrow({
        where: {
          id: serviceLaborId,
          serviceRecordId,
          serviceRecord: { organizationId: ctx.organizationId },
        },
        select: { executionType: true },
      })
      const lines = await db.supplierServiceLine.findMany({
        where: { organizationId: ctx.organizationId, serviceRecordId, serviceLaborId },
        include: {
          document: {
            include: {
              supplier: { select: { name: true } },
              reversals: { select: { id: true } },
              _count: { select: { supplierServiceLine_document: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      })
      const suppliers = await db.supplier.findMany({
        where: {
          organizationId: ctx.organizationId,
          archivedAt: null,
          kind: { in: ['SERVICES', 'BOTH'] },
        },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      })
      const { getCachedMembership } = await import('@/lib/cached-session')
      const { ledgerCapabilities } = await import('../Lib/capabilities')
      const member = await getCachedMembership(ctx.userId)
      const caps = ledgerCapabilities(ctx.isAdmin, member?.customRole?.permissions ?? [])
      return {
        canDraft: caps.financeDraft,
        canPost: caps.financePost,
        canReverse: caps.financeReverse,
        executionType: work.executionType,
        suppliers,
        lines: lines.map((l) => ({
          id: l.id,
          lineCount: l.document._count.supplierServiceLine_document,
          supplierId: l.document.supplierId,
          externalNumber: l.document.externalNumber ?? '',
          dueDate: l.document.dueDate.toISOString().slice(0, 10),
          unitCost: l.unitCost.toString(),
          quantity: l.quantity.toString(),
          taxMode: l.taxMode,
          taxRate: l.taxRate.toString(),
          documentId: l.document.id,
          version: l.document.version,
          status: l.document.status,
          reversed: l.document.reversals.length > 0,
          reversal: Boolean(l.document.reversalOfId),
          tax: l.taxAmount.toString(),
          net: l.netAmount.toString(),
          number: l.document.number,
          supplier: l.document.supplier.name,
          total: l.totalAmount.toString(),
          date: l.document.effectiveAt.toISOString().slice(0, 10),
        })),
      }
    },
    {
      requiredPermissions: [
        permission(A.READ, S.STOCK_COST),
        permission(A.READ, S.SUPPLIER_FINANCE),
      ],
    }
  )
}
export async function postWorkSubcontract(input: unknown) {
  return withAuth(
    async (ctx) => {
      enabled()
      const { createFinance } = await import('../Lib/finance')
      return createFinance(ledgerDB, ctx).postSubcontract(input)
    },
    {
      requiredPermissions: [
        permission(A.POST, S.SUPPLIER_FINANCE),
        permission(A.READ, S.STOCK_COST),
      ],
    }
  )
}

export async function bulkFulfillment(input: unknown, preview: boolean) {
  return withAuth(
    async (ctx) => {
      enabled()
      z.boolean().parse(preview)
      const { bulkStockOperation, previewBulkStock } = await import('../Lib/bulk')
      return preview
        ? previewBulkStock(ledgerDB, ctx, input)
        : bulkStockOperation(ledgerDB, ctx, input)
    },
    {
      requiredPermissions: [
        permission(
          (input as { operation?: string })?.operation === 'reserve'
            ? A.RESERVE
            : (input as { operation?: string })?.operation === 'purchase'
              ? A.CREATE
              : A.ISSUE,
          S.STOCK_LEDGER
        ),
        permission(A.READ, S.STOCK_LEDGER),
        ...((input as { operation?: string })?.operation === 'purchase'
          ? [permission(A.READ, S.STOCK_COST)]
          : []),
      ],
    }
  )
}

export async function reopenAccountingPeriod(input: unknown) {
  return withAuth(async (ctx) => {
    enabled()
    if (!ctx.isAdmin) throw new Error('Період відкриває адміністратор')
    const { reopenLedgerPeriod } = await import('../Lib/administration')
    return reopenLedgerPeriod(ledgerDB, ctx, input)
  })
}

export async function getPartyPeriodStatement(input: unknown) {
  return withAuth(
    async (ctx) => {
      enabled()
      const { partyStatement } = await import('../Lib/statement')
      return ledgerDB.$transaction((tx) => partyStatement(tx, ctx, input), {
        isolationLevel: 'RepeatableRead',
      })
    },
    { requiredPermissions: [permission(A.READ, S.SUPPLIER_FINANCE)] }
  )
}

export async function paymentDraftCommand(operation: 'save' | 'post' | 'cancel', input: unknown) {
  return withAuth(
    async (ctx) => {
      enabled()
      const { paymentDraftOperations } = await import('../Lib/paymentDrafts')
      return paymentDraftOperations(ledgerDB, ctx)[
        z.enum(['save', 'post', 'cancel']).parse(operation)
      ](input)
    },
    {
      requiredPermissions: [
        permission(operation === 'post' ? A.POST : A.CREATE, S.SUPPLIER_FINANCE),
      ],
    }
  )
}
export async function listPaymentDrafts(partyId: string, page = 1) {
  return withAuth(
    async (ctx) => {
      enabled()
      z.number().int().positive().parse(page)
      const where = { organizationId: ctx.organizationId, partyId, status: 'DRAFT' }
      const rows = await db.moneyTransaction.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 25,
        skip: (page - 1) * 25,
      })
      return {
        rows: rows.map((r) => ({
          ...r,
          amount: r.amount.toString(),
          effectiveAt: r.effectiveAt.toISOString().slice(0, 10),
        })),
        total: await db.moneyTransaction.count({ where }),
      }
    },
    { requiredPermissions: [permission(A.READ, S.SUPPLIER_FINANCE)] }
  )
}

export async function getAllocationSuggestion(creditId: string) {
  return withAuth(
    async (ctx) => {
      enabled()
      const { suggestAllocation } = await import('../Lib/allocationBatch')
      return ledgerDB.$transaction((tx) =>
        suggestAllocation(tx, ctx, z.string().min(1).parse(creditId))
      )
    },
    {
      requiredPermissions: [
        permission(A.READ, S.SUPPLIER_FINANCE),
        permission(A.ALLOCATE, S.SUPPLIER_FINANCE),
      ],
    }
  )
}
export async function allocatePaymentBatch(input: unknown) {
  return withAuth(
    async (ctx) => {
      enabled()
      const { allocateBatch } = await import('../Lib/allocationBatch')
      return allocateBatch(ledgerDB, ctx, input)
    },
    { requiredPermissions: [permission(A.ALLOCATE, S.SUPPLIER_FINANCE)] }
  )
}

export async function getLedgerImportTask(id: string) {
  return withAuth(
    async (ctx) => {
      enabled()
      return db.ledgerImportTask.findFirstOrThrow({
        where: { organizationId: ctx.organizationId, id },
        select: {
          id: true,
          status: true,
          error: true,
          sourceName: true,
          previewJobId: true,
          attempts: true,
        },
      })
    },
    { requiredPermissions: draft }
  )
}
export async function retryLedgerImportTask(id: string) {
  return withAuth(
    async (ctx) => {
      enabled()
      const task = await db.ledgerImportTask.findFirstOrThrow({
        where: { organizationId: ctx.organizationId, id, status: 'FAILED' },
      })
      await db.ledgerImportTask.updateMany({
        where: { organizationId: ctx.organizationId, id, status: 'FAILED' },
        data: { status: 'QUEUED', attempts: 0, error: null },
      })
      const { after } = await import('next/server'),
        { runImportTasks } = await import('../Lib/importQueue')
      after(() =>
        runImportTasks(db as unknown as import('@/generated/prisma/client').PrismaClient, task.id)
      )
      return { id: task.id }
    },
    { requiredPermissions: draft }
  )
}
export async function listRecentLedgerImports() {
  return withAuth(
    async (ctx) => {
      enabled()
      return db.ledgerImportTask.findMany({
        where: { organizationId: ctx.organizationId },
        select: { id: true, sourceName: true, status: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 25,
      })
    },
    { requiredPermissions: draft }
  )
}
export async function getLedgerCapabilities() {
  return withAuth(async (ctx) => {
    enabled()
    const { getCachedMembership } = await import('@/lib/cached-session'),
      { ledgerCapabilities } = await import('../Lib/capabilities')
    const member = await getCachedMembership(ctx.userId)
    return ledgerCapabilities(ctx.isAdmin, member?.customRole?.permissions ?? [])
  })
}

export async function getCustomerLedger(recordId: string) {
  return withAuth(
    async (ctx) => {
      enabled()
      const { customerBalance } = await import('../Lib/customerFinance')
      const [balance, accounts] = await Promise.all([
        ledgerDB.$transaction((tx) => customerBalance(tx, ctx, recordId)),
        db.cashAccount.findMany({
          where: { organizationId: ctx.organizationId, archivedAt: null },
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        }),
      ])
      const { getCachedMembership } = await import('@/lib/cached-session')
      const { hasPermission } = await import('@/lib/permissions')
      const member = await getCachedMembership(ctx.userId),
        permissions = member?.customRole?.permissions ?? []
      return {
        ...balance,
        accounts,
        canPay: ctx.isAdmin || hasPermission(permissions, permission(A.CREATE, S.BILLING)),
        canAdjust: ctx.isAdmin || hasPermission(permissions, permission(A.REVERSE, S.BILLING)),
      }
    },
    { requiredPermissions: [permission(A.READ, S.BILLING)] }
  )
}
export async function issueLedgerCustomerInvoice(input: unknown) {
  return withAuth(
    async (ctx) => {
      enabled()
      const { chargeSchema } = await import('../Lib/contracts')
      const parsed = chargeSchema.parse(input)
      const result = await createFinance(ledgerDB, ctx).issueCustomerCharge(input)
      const { issueInvoice } = await import('@/features/invoices/Lib/issueInvoice')
      await issueInvoice(parsed.serviceRecordId, ctx.organizationId, 'sent')
      return result
    },
    { requiredPermissions: [permission(A.CREATE, S.BILLING)] }
  )
}
export async function customerLedgerAdjustment(input: unknown) {
  return withAuth(
    async (ctx) => {
      enabled()
      const { postCustomerAdjustment } = await import('../Lib/customerFinance')
      return postCustomerAdjustment(ledgerDB, ctx, input)
    },
    { requiredPermissions: [permission(A.REVERSE, S.BILLING)] }
  )
}
export async function customerLedgerPayment(input: unknown) {
  return withAuth(
    async (ctx) => {
      enabled()
      const { postCustomerMoney } = await import('../Lib/customerFinance')
      return postCustomerMoney(ledgerDB, ctx, input)
    },
    { requiredPermissions: [permission(A.CREATE, S.BILLING)] }
  )
}

export async function getLedgerProviderAccounts() {
  return withAuth(async (ctx) => {
    enabled()
    if (!ctx.isAdmin) throw new Error('Налаштування змінює адміністратор')
    const [accounts, settings] = await Promise.all([
      db.cashAccount.findMany({
        where: { organizationId: ctx.organizationId, archivedAt: null },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      db.appSetting.findMany({
        where: {
          organizationId: ctx.organizationId,
          key: { startsWith: 'stockLedger.vendorAccount.' },
        },
        select: { key: true, value: true },
      }),
    ])
    return { accounts, settings }
  })
}
export async function setLedgerProviderAccount(raw: unknown) {
  return withAuth(async (ctx) => {
    enabled()
    if (!ctx.isAdmin) throw new Error('Налаштування змінює адміністратор')
    const { commandSchema } = await import('../Lib/contracts'),
      { ledgerCommand } = await import('../Lib/transaction'),
      { vendorAccountKey } = await import('../Lib/vendorPayments')
    const input = commandSchema
      .extend({ provider: z.string().regex(/^[a-z0-9_-]{1,40}$/), accountId: z.string().min(1) })
      .parse(raw)
    return ledgerCommand(ledgerDB, ctx, 'provider.account', input, async (tx) => {
      await tx.cashAccount.findFirstOrThrow({
        where: { organizationId: ctx.organizationId, id: input.accountId, archivedAt: null },
      })
      const key = { organizationId: ctx.organizationId, key: vendorAccountKey(input.provider) }
      const before = await tx.appSetting.findUnique({ where: { organizationId_key: key } })
      await tx.appSetting.upsert({
        where: { organizationId_key: key },
        create: { ...key, userId: ctx.userId, value: input.accountId },
        update: { value: input.accountId },
      })
      return { id: input.provider, before: before?.value ?? null, accountId: input.accountId }
    })
  })
}

export async function customerLedgerAdvance(input: unknown) {
  return withAuth(
    async (ctx) => {
      enabled()
      const { allocateCustomerAdvance } = await import('../Lib/customerFinance')
      return allocateCustomerAdvance(ledgerDB, ctx, input)
    },
    { requiredPermissions: [permission(A.CREATE, S.BILLING)] }
  )
}

export async function getStockCatalogs() {
  return withAuth(async (ctx) => {
    enabled()
    if (!ctx.isAdmin) throw new Error('Довідники налаштовує адміністратор')
    const where = { organizationId: ctx.organizationId }
    const [units, locations, warehouses] = await Promise.all([
      db.unitOfMeasure.findMany({ where, orderBy: { code: 'asc' }, take: 500 }),
      db.warehouseLocation.findMany({
        where,
        include: { warehouse: { select: { name: true } } },
        orderBy: [{ warehouseId: 'asc' }, { code: 'asc' }],
        take: 1000,
      }),
      db.warehouse.findMany({
        where: { ...where, archivedAt: null },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
    ])
    return { units, locations, warehouses }
  })
}
export async function saveStockCatalog(
  kind: 'unit' | 'location' | 'product' | 'supplierProduct',
  input: unknown
) {
  return withAuth(async (ctx) => {
    enabled()
    if (!ctx.isAdmin) throw new Error('Довідники налаштовує адміністратор')
    const { catalogOperations } = await import('../Lib/catalogs')
    const operation = z.enum(['unit', 'location', 'product', 'supplierProduct']).parse(kind)
    return catalogOperations(ledgerDB, ctx)[operation](input)
  })
}
export async function getProductCatalog(productId: string) {
  return withAuth(
    async (ctx) => {
      enabled()
      const where = { organizationId: ctx.organizationId }
      const product = await db.inventoryPart.findFirstOrThrow({
        where: { ...where, id: productId },
        select: {
          id: true,
          name: true,
          unit: true,
          unitId: true,
          locationId: true,
          trackingMode: true,
          updatedAt: true,
        },
      })
      const [units, locations, suppliers, mappings] = await Promise.all([
        db.unitOfMeasure.findMany({
          where: { ...where, archivedAt: null },
          orderBy: { code: 'asc' },
        }),
        db.warehouseLocation.findMany({
          where: { ...where, archivedAt: null },
          include: { warehouse: { select: { name: true } } },
          orderBy: { code: 'asc' },
        }),
        db.supplier.findMany({
          where: { ...where, archivedAt: null, kind: { in: ['GOODS', 'BOTH'] } },
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        }),
        db.supplierProduct.findMany({
          where: { ...where, inventoryPartId: product.id },
          include: { supplier: { select: { name: true } } },
          orderBy: [{ preferred: 'desc' }, { supplierId: 'asc' }],
        }),
      ])
      return {
        product: { ...product, updatedAt: product.updatedAt.toISOString() },
        units,
        locations,
        suppliers,
        isAdmin: ctx.isAdmin,
        mappings: mappings.map((m) => ({
          ...m,
          lastQuotedPrice: m.lastQuotedPrice?.toFixed(6) ?? null,
        })),
      }
    },
    { requiredPermissions: stockRead }
  )
}

export async function saveWorkSubcontractDraft(input: unknown) {
  return withAuth(
    async (ctx) => {
      enabled()
      const { subcontractOperations } = await import('../Lib/subcontracts')
      return subcontractOperations(ledgerDB, ctx).save(input)
    },
    {
      requiredPermissions: [
        permission(A.CREATE, S.SUPPLIER_FINANCE),
        permission(A.READ, S.STOCK_COST),
      ],
    }
  )
}
export async function transitionWorkSubcontract(input: unknown, cancel: boolean) {
  return withAuth(
    async (ctx) => {
      enabled()
      z.boolean().parse(cancel)
      const { subcontractOperations } = await import('../Lib/subcontracts')
      return subcontractOperations(ledgerDB, ctx).transition(input, cancel)
    },
    {
      requiredPermissions: [
        permission(A.POST, S.SUPPLIER_FINANCE),
        permission(A.READ, S.STOCK_COST),
      ],
    }
  )
}
export async function reverseWorkSubcontract(input: unknown) {
  return withAuth(
    async (ctx) => {
      enabled()
      const { subcontractOperations } = await import('../Lib/subcontracts')
      return subcontractOperations(ledgerDB, ctx).reverse(input)
    },
    {
      requiredPermissions: [
        permission(A.REVERSE, S.SUPPLIER_FINANCE),
        permission(A.READ, S.STOCK_COST),
      ],
    }
  )
}

export async function previewLedgerMigration(manifest: unknown) {
  return withAuth(async (ctx) => {
    enabled()
    if (!ctx.isAdmin) throw new Error('Перехід виконує адміністратор')
    const { migrationChecksum, applyMigrationBatch } = await import('../Lib/migrationBatch')
    const checksum = migrationChecksum(manifest)
    const result = await applyMigrationBatch(
      ledgerDB,
      ctx,
      { manifest, checksum, confirmed: true, idempotencyKey: 'preview:' + checksum },
      true
    )
    return { checksum, result }
  })
}
export async function commitLedgerMigration(input: unknown) {
  return withAuth(async (ctx) => {
    enabled()
    if (!ctx.isAdmin) throw new Error('Перехід виконує адміністратор')
    const { applyMigrationBatch } = await import('../Lib/migrationBatch')
    return applyMigrationBatch(ledgerDB, ctx, input)
  })
}

export async function getProductStockDetails(input: unknown) {
  return withAuth(
    async (ctx) => {
      enabled()
      const { productDetails } = await import('../Lib/productDetails')
      return ledgerDB.$transaction((tx) => productDetails(tx, ctx, input), {
        isolationLevel: 'RepeatableRead',
      })
    },
    { requiredPermissions: [permission(A.READ, S.STOCK_LEDGER)] }
  )
}
export async function getSupplierCard(input: unknown) {
  return withAuth(
    async (ctx) => {
      enabled()
      const { supplierCard } = await import('../Lib/supplierCard')
      return ledgerDB.$transaction((tx) => supplierCard(tx, ctx, input), {
        isolationLevel: 'RepeatableRead',
      })
    },
    { requiredPermissions: [...stockRead, permission(A.READ, S.SUPPLIER_FINANCE)] }
  )
}

export async function getPurchaseSuggestion(productId: string) {
  return withAuth(
    async (ctx) => {
      enabled()
      const row = await db.supplierProduct.findFirst({
        where: {
          organizationId: ctx.organizationId,
          inventoryPartId: z.string().min(1).parse(productId),
          preferred: true,
          archivedAt: null,
          supplier: { archivedAt: null },
        },
        select: { supplierId: true, lastQuotedPrice: true, leadTimeDays: true },
      })
      return row
        ? {
            supplierId: row.supplierId,
            price: row.lastQuotedPrice?.toFixed(6) ?? '0',
            leadTimeDays: row.leadTimeDays,
          }
        : null
    },
    { requiredPermissions: stockRead }
  )
}
