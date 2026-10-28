// @vitest-environment node
import { allocateBatch, suggestAllocation } from '@/features/stock-ledger/Lib/allocationBatch'
import {
  ensureCustomerInvoice,
  allocateCustomerAdvance,
  customerBalance,
  postCustomerAdjustment,
  postCustomerMoney,
} from '@/features/stock-ledger/Lib/customerFinance'
import { ledgerVendorPayment, vendorAccountKey } from '@/features/stock-ledger/Lib/vendorPayments'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { readFinancialSnapshot } from '@/features/stock-ledger/Lib/financialSnapshot'
import { paymentDraftOperations } from '@/features/stock-ledger/Lib/paymentDrafts'
import { createFinance } from '@/features/stock-ledger/Lib/finance'
import { fullReconciliation } from '@/features/stock-ledger/Lib/reconciliation'
import { D } from '@/features/stock-ledger/Lib/amounts'
import { createStockLedger } from '@/features/stock-ledger/Lib/service'
import { createStockOperations } from '@/features/stock-ledger/Lib/stock'
import { createStockAdjustments } from '@/features/stock-ledger/Lib/adjustments'
import { createSettlementOperations } from '@/features/stock-ledger/Lib/settlements'
import { returnToSupplier } from '@/features/stock-ledger/Lib/supplierReturns'
import { reverseReceipt } from '@/features/stock-ledger/Lib/reverseReceipt'
const url = process.env.LEDGER_TEST_DATABASE_URL
if (
  url &&
  !/^postgresql:\/\/[^@]+@(?:127\.0\.0\.1|localhost):\d+\/crm_ledger_test(?:\?|$)/.test(url)
)
  throw new Error('Use isolated local crm_ledger_test')
const key = randomUUID,
  date = '2026-10-20'
;(url ? describe : describe.skip)('persisted financial conservation', () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  const org = key(),
    user = key(),
    ctx = { organizationId: org, userId: user }
  const service = createStockLedger(db, ctx),
    stock = createStockOperations(db, ctx)
  let warehouseId: string, secondWarehouseId: string, accountId: string
  beforeAll(async () => {
    await db.user.create({
      data: { id: user, name: 'Rounding test', email: `${user}@example.test` },
    })
    await db.organization.create({ data: { id: org, name: 'Isolated rounding tests' } })
    warehouseId = (await service.createWarehouse({ idempotencyKey: key(), code: 'A', name: 'A' }))
      .id
    secondWarehouseId = (
      await service.createWarehouse({ idempotencyKey: key(), code: 'B', name: 'B' })
    ).id
    accountId = (await service.createAccount({ idempotencyKey: key(), name: 'Bank' })).id
  })
  afterAll(() => db.$disconnect())
  async function receipt(quantity = '3', unitPrice = '0.333333', extra = {}) {
    const supplier = await service.createSupplier({ idempotencyKey: key(), name: key() })
    const part = await db.inventoryPart.create({
      data: { organizationId: org, userId: user, name: 'Oil', unit: 'l' },
    })
    const doc = await service.saveReceiptDraft({
      idempotencyKey: key(),
      supplierId: supplier.id,
      warehouseId,
      effectiveAt: date,
      externalNumber: key(),
      externalDate: date,
      dueDate: date,
      lines: [{ inventoryPartId: part.id, quantity, unitPrice, ...extra }],
    })
    await service.postReceipt({ idempotencyKey: key(), documentId: doc.id, expectedVersion: 1 })
    const lot = await db.stockLot.findFirstOrThrow({
      where: { sourceLine: { documentId: doc.id } },
      include: { sourceLine: true },
    })
    return { doc, lot, part, supplier }
  }
  it('completion and invoice delivery converge on one charge, while drafts and foreign jobs cannot be charged', async () => {
    const customer = await db.customer.create({
      data: { organizationId: org, userId: user, name: 'Invoice recipient' },
    })
    const job = await db.serviceRecord.create({
      data: {
        organizationId: org,
        title: 'Final invoice',
        customerId: customer.id,
        financeAccountingMode: 'LEDGER',
        totalAmount: 3.33,
      },
    })
    await Promise.all([
      ensureCustomerInvoice(db, ctx, job.id, date),
      ensureCustomerInvoice(db, ctx, job.id, date),
    ])
    expect(await db.settlementEntry.count({ where: { serviceRecordId: job.id } })).toBe(1)
    expect(await ensureCustomerInvoice(db, ctx, job.id, date)).toBeNull()
    await expect(
      ensureCustomerInvoice(db, { ...ctx, organizationId: key() }, job.id, date)
    ).rejects.toThrow()
    const missing = await db.serviceRecord.create({
      data: {
        organizationId: org,
        title: 'No payer',
        financeAccountingMode: 'LEDGER',
        totalAmount: 1,
      },
    })
    await expect(ensureCustomerInvoice(db, ctx, missing.id, date)).rejects.toThrow('платника')
    const legacy = await db.serviceRecord.create({
      data: { organizationId: org, title: 'Legacy issue', totalAmount: 1 },
    })
    expect(await ensureCustomerInvoice(db, ctx, legacy.id, date)).toBeNull()
  })
  it('takes advance before issue without freezing the draft; explicit allocation cannot exceed current debt', async () => {
    const customer = await db.customer.create({
      data: { organizationId: org, userId: user, name: 'Advance payer' },
    })
    const job = await db.serviceRecord.create({
      data: {
        organizationId: org,
        title: 'Advance draft',
        customerId: customer.id,
        financeAccountingMode: 'LEDGER',
        totalAmount: 1,
      },
    })
    const payment = await postCustomerMoney(db, ctx, {
      idempotencyKey: key(),
      serviceRecordId: job.id,
      accountId,
      amount: '1.01',
      direction: 'IN',
      effectiveAt: date,
      method: 'cash',
      confirmed: true,
    })
    expect(payment.unallocated).toBe('1.01')
    const draft = await db.$transaction((tx) => customerBalance(tx, ctx, job.id))
    expect(draft).toMatchObject({ issued: false, debt: '0.00', advance: '1.01' })
    expect(
      (await db.serviceRecord.findUniqueOrThrow({ where: { id: job.id } })).billedPartyId
    ).toBeNull()
    await db.serviceRecord.update({ where: { id: job.id }, data: { totalAmount: 1.02 } })
    await createFinance(db, ctx).issueCustomerCharge({
      idempotencyKey: key(),
      serviceRecordId: job.id,
      customerId: customer.id,
      effectiveAt: date,
      dueDate: date,
    })
    expect((await db.$transaction((tx) => customerBalance(tx, ctx, job.id))).debt).toBe('1.02')
    const input = {
      idempotencyKey: key(),
      serviceRecordId: job.id,
      creditEntryId: payment.entryId,
      amount: '1.01',
      effectiveAt: date,
      confirmed: true,
    }
    await allocateCustomerAdvance(db, ctx, input)
    await allocateCustomerAdvance(db, ctx, input)
    expect(await db.$transaction((tx) => customerBalance(tx, ctx, job.id))).toMatchObject({
      debt: '0.01',
      advance: '0.00',
    })
    await expect(
      allocateCustomerAdvance(db, ctx, { ...input, idempotencyKey: key(), amount: '0.01' })
    ).rejects.toThrow('Залишки змінилися')
  })
  it('provider callbacks use the ledger exactly once, need an explicit account and never create legacy cash', async () => {
    const before = process.env.STOCK_LEDGER_ENABLED
    process.env.STOCK_LEDGER_ENABLED = 'true'
    try {
      const customer = await db.customer.create({
        data: { organizationId: org, userId: user, name: 'Provider payer' },
      })
      const job = await db.serviceRecord.create({
        data: {
          organizationId: org,
          title: 'Provider invoice',
          customerId: customer.id,
          financeAccountingMode: 'LEDGER',
          totalAmount: 1,
        },
      })
      const input = {
        serviceRecordId: job.id,
        provider: 'stripe',
        externalId: key(),
        amount: 1.01,
        method: 'card',
        date: new Date(date),
      }
      await expect(ledgerVendorPayment(db, input)).rejects.toThrow('налаштуйте рахунок')
      expect(await db.settlementEntry.count({ where: { serviceRecordId: job.id } })).toBe(0)
      await db.appSetting.upsert({
        where: { organizationId_key: { organizationId: org, key: vendorAccountKey('stripe') } },
        create: {
          organizationId: org,
          userId: user,
          key: vendorAccountKey('stripe'),
          value: accountId,
        },
        update: { value: accountId },
      })
      const results = await Promise.all([
        ledgerVendorPayment(db, input),
        ledgerVendorPayment(db, input),
      ])
      expect(results.map((r) => r?.created).sort()).toEqual([false, true])
      expect(results[0]?.id).toBe(results[1]?.id)
      expect(await db.payment.count({ where: { serviceRecordId: job.id } })).toBe(0)
      expect((await db.$transaction((tx) => customerBalance(tx, ctx, job.id))).debt).toBe('0.00')
      await expect(ledgerVendorPayment(db, { ...input, amount: 1.02 })).rejects.toThrow(
        'amount differs'
      )
      const legacy = await db.serviceRecord.create({
        data: { organizationId: org, title: 'Legacy' },
      })
      expect(await ledgerVendorPayment(db, { ...input, serviceRecordId: legacy.id })).toBeNull()
      process.env.STOCK_LEDGER_ENABLED = 'false'
      await expect(ledgerVendorPayment(db, { ...input, externalId: key() })).rejects.toThrow(
        'disabled'
      )
    } finally {
      if (before === undefined) delete process.env.STOCK_LEDGER_ENABLED
      else process.env.STOCK_LEDGER_ENABLED = before
    }
  })
  it('AC10: credit notes reduce receivables independently of cash; refunds consume only available credit', async () => {
    const customer = await db.customer.create({
      data: { organizationId: org, userId: user, name: 'Credit customer' },
    })
    const job = await db.serviceRecord.create({
      data: {
        organizationId: org,
        title: 'Credit test',
        type: 'repair',
        serviceDate: new Date(date),
        cost: 0,
        totalAmount: 10,
        customerId: customer.id,
        financeAccountingMode: 'LEDGER',
      },
    })
    await createFinance(db, ctx).issueCustomerCharge({
      idempotencyKey: key(),
      serviceRecordId: job.id,
      customerId: customer.id,
      effectiveAt: date,
      dueDate: date,
    })
    const payment = {
      idempotencyKey: key(),
      serviceRecordId: job.id,
      accountId,
      amount: '10.01',
      direction: 'IN',
      effectiveAt: date,
      method: 'cash',
      confirmed: true,
    }
    expect((await postCustomerMoney(db, ctx, payment)).unallocated).toBe('0.01')
    await postCustomerMoney(db, ctx, payment)
    const cashBefore = await db.cashLedgerEntry.count({ where: { organizationId: org } })
    const credit = {
      idempotencyKey: key(),
      serviceRecordId: job.id,
      kind: 'CREDIT',
      amount: '3.33',
      effectiveAt: date,
      reason: 'Return price correction',
      confirmed: true,
    }
    const result = await postCustomerAdjustment(db, ctx, credit)
    expect(await postCustomerAdjustment(db, ctx, credit)).toEqual(result)
    expect(await db.cashLedgerEntry.count({ where: { organizationId: org } })).toBe(cashBefore)
    const state = await db.$transaction((tx) => customerBalance(tx, ctx, job.id))
    expect(state).toMatchObject({ total: '6.67', debt: '0.00', credit: '3.33' })
    await expect(
      postCustomerAdjustment(db, ctx, { ...credit, idempotencyKey: key(), amount: '6.68' })
    ).rejects.toThrow('перевищує')
    const refund = { ...payment, idempotencyKey: key(), direction: 'OUT', amount: '3.34' }
    await postCustomerMoney(db, ctx, refund)
    await postCustomerMoney(db, ctx, refund)
    await expect(
      postCustomerMoney(db, ctx, { ...refund, idempotencyKey: key(), amount: '0.01' })
    ).rejects.toThrow('перевищує')
    expect((await db.$transaction((tx) => customerBalance(tx, ctx, job.id))).credit).toBe('0.00')
    const debit = await postCustomerAdjustment(db, ctx, {
      ...credit,
      idempotencyKey: key(),
      kind: 'DEBIT',
      amount: '0.03',
      reason: 'Additional agreed service',
    })
    expect((await db.$transaction((tx) => customerBalance(tx, ctx, job.id))).debt).toBe('0.03')
    await postCustomerAdjustment(db, ctx, { ...credit, idempotencyKey: key(), amount: '0.02' })
    expect((await db.$transaction((tx) => customerBalance(tx, ctx, job.id))).debt).toBe('0.01')
    const projection = await db.$queryRaw<
      { total: string; debt: string }[]
    >`SELECT total::text,debt::text FROM ledger_customer_balances WHERE "organizationId"=${org} AND "serviceRecordId"=${job.id}`
    expect(projection[0]).toEqual({ total: '6.68', debt: '0.01' })
    await expect(
      db.payment.create({ data: { serviceRecordId: job.id, amount: 1, method: 'cash' } })
    ).rejects.toThrow()

    await expect(
      db.customerAdjustment.update({ where: { id: debit.id }, data: { amount: '0.04' } })
    ).rejects.toThrow()
    await expect(
      postCustomerAdjustment(
        db,
        { ...ctx, organizationId: key() },
        { ...credit, idempotencyKey: key() }
      )
    ).rejects.toThrow()
    expect((await db.serviceRecord.findUniqueOrThrow({ where: { id: job.id } })).totalAmount).toBe(
      10
    )
  })
  it('batch allocation suggests due order, applies atomically and rejects stale overspend', async () => {
    const { supplier } = await receipt('1', '1')
    const party = await db.settlementParty.findFirstOrThrow({ where: { supplierId: supplier.id } })
    const finance = createFinance(db, ctx)
    await finance.openingBalance({
      idempotencyKey: key(),
      partyId: party.id,
      side: 'AP',
      polarity: 'DEBIT',
      amount: '0.02',
      effectiveAt: date,
      sourceNote: 'Verified test opening',
      batchKey: key(),
    })
    const payment = await service.postMoneyTransaction({
      idempotencyKey: key(),
      partyId: party.id,
      accountId,
      direction: 'OUT',
      amount: '1.03',
      effectiveAt: date,
      method: 'bank',
    })
    const credit = await db.settlementEntry.findFirstOrThrow({
      where: { moneyTransactionId: payment.id },
    })
    const plan = await db.$transaction((tx) => suggestAllocation(tx, ctx, credit.id))
    expect(plan.lines.map((l) => l.amount)).toEqual(['1.00', '0.02'])
    expect(plan.unallocated).toBe('0.01')
    const input = {
      idempotencyKey: key(),
      creditEntryId: credit.id,
      effectiveAt: date,
      lines: plan.lines.map(({ debitEntryId, amount }) => ({ debitEntryId, amount })),
    }
    const before = await db.settlementAllocation.count({ where: { organizationId: org } })
    await expect(
      allocateBatch(db, ctx, {
        ...input,
        idempotencyKey: key(),
        lines: [input.lines[0], { ...input.lines[1], amount: '0.03' }],
      })
    ).rejects.toThrow('залишок')
    expect(await db.settlementAllocation.count({ where: { organizationId: org } })).toBe(before)
    const result = await allocateBatch(db, ctx, input)
    expect(result.total).toBe('1.02')
    expect(await allocateBatch(db, ctx, input)).toEqual(result)
    await expect(allocateBatch(db, ctx, { ...input, idempotencyKey: key() })).rejects.toThrow(
      'залишок'
    )
    await expect(
      db.$transaction((tx) => suggestAllocation(tx, { ...ctx, organizationId: key() }, credit.id))
    ).rejects.toThrow()
  })
  it('capitalizes extra receipt cost, preserves AP and reverses the exact carrying value', async () => {
    const supplier = await service.createSupplier({ idempotencyKey: key(), name: key() })
    const products = await Promise.all(
      [1, 2, 3].map((i) =>
        db.inventoryPart.create({
          data: { organizationId: org, userId: user, name: 'Cost ' + i, unit: 'pcs' },
        })
      )
    )
    const input = {
      idempotencyKey: key(),
      supplierId: supplier.id,
      warehouseId,
      effectiveAt: date,
      externalDate: date,
      externalNumber: key(),
      dueDate: date,
      additionalCost: '0.02',
      roundingAdjustment: '-0.01',
      roundingReason: 'Supplier rounding difference',
      sourceTotal: '3.01',
      lines: products.map((p) => ({ inventoryPartId: p.id, quantity: '1', unitPrice: '1' })),
    }
    const draft = await service.saveReceiptDraft(input)
    await service.postReceipt({ idempotencyKey: key(), documentId: draft.id, expectedVersion: 1 })
    const lines = await db.inventoryDocumentLine.findMany({
      where: { documentId: draft.id },
      orderBy: { sortOrder: 'asc' },
    })
    expect(lines.map((l) => l.additionalCostAmount.toFixed(2))).toEqual(['0.01', '0.01', '0.00'])
    const movements = await db.inventoryLedgerEntry.aggregate({
      where: { documentLine: { documentId: draft.id } },
      _sum: { costAmountDelta: true },
    })
    expect(movements._sum.costAmountDelta?.toFixed(2)).toBe('3.02')
    const entry = await db.settlementEntry.findFirstOrThrow({
      where: { inventoryDocumentId: draft.id },
    })
    expect(entry.amount.toFixed(2)).toBe('3.01')
    await reverseReceipt(db, ctx, {
      idempotencyKey: key(),
      id: draft.id,
      effectiveAt: date,
      reason: 'Reverse receipt with capitalized delivery',
    })
    const sum = await db.inventoryLedgerEntry.aggregate({
      where: { lot: { sourceLine: { documentId: draft.id } } },
      _sum: { costAmountDelta: true },
    })
    expect(sum._sum.costAmountDelta?.toFixed(2)).toBe('0.00')
    await expect(
      service.saveReceiptDraft({
        ...input,
        idempotencyKey: key(),
        externalNumber: key(),
        sourceTotal: '4',
      })
    ).rejects.toThrow('не збігається')
  })
  async function totals(lotId: string, warehouse?: string) {
    const value = await db.inventoryLedgerEntry.aggregate({
      where: { organizationId: org, lotId, ...(warehouse ? { warehouseId: warehouse } : {}) },
      _sum: { quantityDelta: true, costAmountDelta: true },
    })
    return {
      quantity: value._sum.quantityDelta?.toFixed(3),
      cost: value._sum.costAmountDelta?.toFixed(6),
    }
  }
  async function demand(partId: string, qty: number) {
    const job = await db.serviceRecord.create({
      data: {
        organizationId: org,
        title: 'Numerical test',
        status: 'in-progress',
        inventoryAccountingMode: 'LEDGER',
      },
    })
    const line = await db.servicePart.create({
      data: { serviceRecordId: job.id, inventoryPartId: partId, name: 'Oil', quantity: qty },
    })
    return stock.createDemand({ idempotencyKey: key(), servicePartId: line.id })
  }
  it.each([
    ['3', '0.333333', ['1', '1', '1']],
    ['0.003', '333.333333', ['0.001', '0.001', '0.001']],
    ['7', '0.001429', ['1', '1', '1', '1', '1', '1', '1']],
    ['3', '0', ['1', '2']],
  ])('supplier return fully reverses qty %s at price %s without cost residue', async (qty, price, chunks) => {
    const { doc, lot, supplier } = await receipt(qty, price, {
      taxMode: 'EXCLUSIVE',
      taxRate: '20',
    })
    let credited = D(0)
    for (const quantity of chunks) {
      const command = {
        idempotencyKey: key(),
        lotId: lot.id,
        warehouseId,
        quantity,
        effectiveAt: date,
        reason: 'Rounding regression',
      }
      const result = await returnToSupplier(db, ctx, command)
      expect(await returnToSupplier(db, ctx, command)).toEqual(result)
      credited = credited.plus(result.credit)
    }
    expect(credited.toFixed(2)).toBe(lot.sourceLine.totalAmount.toFixed(2))
    expect(await totals(lot.id)).toEqual({ quantity: '0.000', cost: '0.000000' })
    const entries = await db.settlementEntry.findMany({
      where: { organizationId: org, partyId: supplier.partyId },
    })
    expect(
      entries
        .reduce((sum, row) => sum.plus(row.amount.mul(row.polarity === 'DEBIT' ? 1 : -1)), D(0))
        .toFixed(2)
    ).toBe('0.00')
    await expect(
      returnToSupplier(db, ctx, {
        idempotencyKey: key(),
        lotId: lot.id,
        warehouseId,
        quantity: '0.001',
        effectiveAt: date,
        reason: 'Overreturn',
      })
    ).rejects.toThrow()
    expect(await db.inventoryDocument.findUniqueOrThrow({ where: { id: doc.id } })).toMatchObject({
      status: 'POSTED',
    })
  })
  it('split issue, split return and reissue preserve the exact original cost', async () => {
    const { lot, part } = await receipt()
    const d = await demand(part.id, 3)
    const command = { demandId: d.id, warehouseId, effectiveAt: date }
    await stock.reserve({ ...command, idempotencyKey: key(), quantity: '3' })
    const issues = []
    for (const quantity of ['1', '2'])
      issues.push(await stock.issue({ ...command, idempotencyKey: key(), quantity }))
    expect(issues.reduce((sum, issue) => sum.plus(issue.cost), D(0)).toFixed(6)).toBe('1.000000')
    expect(await totals(lot.id)).toEqual({ quantity: '0.000', cost: '0.000000' })
    const allocations = await db.documentLotAllocation.findMany({
      where: { demandId: d.id },
      orderBy: { quantity: 'asc' },
    })
    for (const allocation of allocations)
      for (let i = 0; i < allocation.quantity.toNumber(); i++)
        await stock.returnFromWorkOrder({
          idempotencyKey: key(),
          allocationId: allocation.id,
          warehouseId: secondWarehouseId,
          quantity: '1',
          effectiveAt: date,
          reason: 'Unused',
        })
    expect(await totals(lot.id, secondWarehouseId)).toEqual({ quantity: '3.000', cost: '1.000000' })
    await stock.reserve({
      ...command,
      warehouseId: secondWarehouseId,
      idempotencyKey: key(),
      quantity: '3',
    })
    expect(
      (
        await stock.issue({
          ...command,
          warehouseId: secondWarehouseId,
          idempotencyKey: key(),
          quantity: '3',
        })
      ).cost
    ).toBe('1.000000')
    expect(await totals(lot.id)).toEqual({ quantity: '0.000', cost: '0.000000' })
  })
  it('partial then final transfer carries all cost, each warehouse balances independently', async () => {
    const { lot } = await receipt()
    for (const quantity of ['1', '2'])
      await stock.transfer({
        idempotencyKey: key(),
        lotId: lot.id,
        sourceWarehouseId: warehouseId,
        targetWarehouseId: secondWarehouseId,
        quantity,
        effectiveAt: date,
      })
    expect(await totals(lot.id, warehouseId)).toEqual({ quantity: '0.000', cost: '0.000000' })
    expect(await totals(lot.id, secondWarehouseId)).toEqual({ quantity: '3.000', cost: '1.000000' })
    for (const quantity of ['1', '1', '1'])
      await returnToSupplier(db, ctx, {
        idempotencyKey: key(),
        lotId: lot.id,
        warehouseId: secondWarehouseId,
        quantity,
        effectiveAt: date,
        reason: 'Unused',
      })
    expect(await totals(lot.id)).toEqual({ quantity: '0.000', cost: '0.000000' })
  })
  it('stock count to zero clears exact carrying value', async () => {
    const { lot } = await receipt()
    const balance = await db.stockLotBalance.findFirstOrThrow({
      where: { lotId: lot.id, warehouseId },
    })
    await createStockAdjustments(db, ctx).adjust({
      idempotencyKey: key(),
      balanceId: balance.id,
      expectedVersion: balance.version,
      countedQuantity: '0',
      effectiveAt: date,
      reason: 'Verified shortage',
    })
    expect(await totals(lot.id)).toEqual({ quantity: '0.000', cost: '0.000000' })
  })
  it('hundred one-cent payments settle exactly and payment reversal reopens exactly one cent', async () => {
    const { lot, supplier } = await receipt()
    const debit = await db.settlementEntry.findFirstOrThrow({
      where: { inventoryDocumentId: lot.sourceLine.documentId },
    })
    let firstPayment = ''
    for (let i = 0; i < 100; i++) {
      const payment = await service.postMoneyTransaction({
        idempotencyKey: key(),
        partyId: supplier.partyId,
        accountId,
        direction: 'OUT',
        amount: '0.01',
        effectiveAt: date,
        method: 'bank',
      })
      if (!i) firstPayment = payment.id
      await service.allocateSettlement({
        idempotencyKey: key(),
        debitEntryId: debit.id,
        creditEntryId: payment.entryId,
        amount: '0.01',
        effectiveAt: date,
      })
    }
    const applied = () =>
      db.settlementAllocation.aggregate({
        where: { debitEntryId: debit.id, reversedAt: null },
        _sum: { amount: true },
      })
    expect((await applied())._sum.amount?.toFixed(2)).toBe('1.00')
    await createSettlementOperations(db, ctx).reversePayment({
      idempotencyKey: key(),
      id: firstPayment,
      effectiveAt: date,
      reason: 'Duplicate payment',
    })
    expect((await applied())._sum.amount?.toFixed(2)).toBe('0.99')
    const cash = await db.cashLedgerEntry.aggregate({
      where: { moneyTransaction: { partyId: supplier.partyId } },
      _sum: { amountDelta: true },
    })
    expect(cash._sum.amountDelta?.toFixed(2)).toBe('-0.99')
  }, 30000)
  it('receipt reversal cancels exact discounted tax amount and preserves paid advance', async () => {
    const { doc, lot, supplier } = await receipt('3', '0.335', {
      discountType: 'PERCENT',
      discountValue: '33.333333',
      taxMode: 'INCLUSIVE',
      taxRate: '20',
    })
    const debit = await db.settlementEntry.findFirstOrThrow({
      where: { inventoryDocumentId: doc.id },
    })
    expect(debit.amount.toFixed(2)).toBe('0.67')
    const payment = await service.postMoneyTransaction({
      idempotencyKey: key(),
      partyId: supplier.partyId,
      accountId,
      direction: 'OUT',
      amount: '0.67',
      effectiveAt: date,
      method: 'bank',
    })
    await service.allocateSettlement({
      idempotencyKey: key(),
      debitEntryId: debit.id,
      creditEntryId: payment.entryId,
      amount: '0.67',
      effectiveAt: date,
    })
    await reverseReceipt(db, ctx, {
      idempotencyKey: key(),
      id: doc.id,
      effectiveAt: date,
      reason: 'Wrong receipt',
    })
    expect(await totals(lot.id)).toEqual({ quantity: '0.000', cost: '0.000000' })
    expect(
      await db.settlementAllocation.count({
        where: { creditEntryId: payment.entryId, reversedAt: null },
      })
    ).toBe(0)
    expect(
      (await db.moneyTransaction.findUniqueOrThrow({ where: { id: payment.id } })).amount.toFixed(2)
    ).toBe('0.67')
  })
  it.each([
    'DEBIT',
    'CREDIT',
  ])('opening supplier %s keeps cents and no invented cash', async (polarity) => {
    const supplier = await service.createSupplier({ idempotencyKey: key(), name: key() })
    const input = {
      idempotencyKey: key(),
      partyId: supplier.partyId,
      side: 'AP',
      polarity,
      amount: '1234567890.01',
      effectiveAt: date,
      sourceNote: 'Verified balance',
      batchKey: key(),
    }
    const finance = createFinance(db, ctx)
    const result = await finance.openingBalance(input)
    expect(await finance.openingBalance(input)).toEqual(result)
    const entry = await db.settlementEntry.findFirstOrThrow({
      where: { openingBalanceId: result.id },
    })
    expect(entry.amount.toFixed(2)).toBe('1234567890.01')
    expect(entry.polarity).toBe(polarity)
    expect(await db.cashLedgerEntry.count({ where: { openingBalanceId: result.id } })).toBe(0)
    await expect(
      finance.openingBalance({ ...input, idempotencyKey: key(), side: 'AR', batchKey: key() })
    ).rejects.toThrow()
  })
  it('opening cash has exact cents and no counterparty debt', async () => {
    const result = await createFinance(db, ctx).openingBalance({
      idempotencyKey: key(),
      accountId,
      amount: '0.01',
      effectiveAt: date,
      sourceNote: 'Verified cash',
      batchKey: key(),
    })
    expect(
      (
        await db.cashLedgerEntry.findFirstOrThrow({ where: { openingBalanceId: result.id } })
      ).amountDelta.toFixed(2)
    ).toBe('0.01')
    expect(await db.settlementEntry.count({ where: { openingBalanceId: result.id } })).toBe(0)
    for (const input of [{}, { accountId, partyId: 'bad' }, { accountId: 'missing' }])
      await expect(
        createFinance(db, ctx).openingBalance({
          ...input,
          idempotencyKey: key(),
          amount: '1',
          effectiveAt: date,
          sourceNote: 'Verified cash',
          batchKey: key(),
        })
      ).rejects.toThrow()
  })
  it.each([
    -1,
    1.005,
    0.1 + 0.2,
  ])('customer charge rejects ambiguous legacy amount %s rather than rounding silently', async (totalAmount) => {
    const customer = await db.customer.create({
      data: { organizationId: org, userId: user, name: 'Customer' },
    })
    const job = await db.serviceRecord.create({
      data: {
        organizationId: org,
        customerId: customer.id,
        title: 'Charge',
        financeAccountingMode: 'LEDGER',
        totalAmount,
      },
    })
    await expect(
      createFinance(db, ctx).issueCustomerCharge({
        idempotencyKey: key(),
        serviceRecordId: job.id,
        customerId: customer.id,
        effectiveAt: date,
        dueDate: date,
      })
    ).rejects.toThrow()
    expect(await db.settlementEntry.count({ where: { serviceRecordId: job.id } })).toBe(0)
  })
  it('freezes billed party and sale amounts while preserving historical descriptions and mechanic edits', async () => {
    const customer = await db.customer.create({
        data: { organizationId: org, userId: user, name: 'Original payer' },
      }),
      other = await db.customer.create({
        data: { organizationId: org, userId: user, name: 'New car owner' },
      })
    const job = await db.serviceRecord.create({
      data: {
        organizationId: org,
        customerId: customer.id,
        title: 'Frozen invoice',
        financeAccountingMode: 'LEDGER',
        totalAmount: 10,
        subtotal: 10,
        partItems: { create: [{ name: 'Original part', quantity: 1, unitPrice: 10, total: 10 }] },
        laborItems: { create: [{ description: 'Original labor', hours: 0, rate: 0, total: 0 }] },
      },
    })
    const charge = await createFinance(db, ctx).issueCustomerCharge({
      idempotencyKey: key(),
      serviceRecordId: job.id,
      customerId: customer.id,
      effectiveAt: date,
      dueDate: date,
    })
    const saved = await db.serviceRecord.findUniqueOrThrow({ where: { id: job.id } }),
      snapshot = readFinancialSnapshot(saved.ledgerFinancialSnapshot)!
    expect(snapshot.total).toBe('10.00')
    expect(saved.billedPartyId).toBe(charge.partyId)
    await db.serviceRecord.update({
      where: { id: job.id },
      data: { customerId: other.id, description: 'Nonfinancial note' },
    })
    await expect(
      db.serviceRecord.update({ where: { id: job.id }, data: { totalAmount: 11 } })
    ).rejects.toThrow('незмінний')
    await expect(
      db.serviceRecord.update({ where: { id: job.id }, data: { manuallyPaid: true } })
    ).rejects.toThrow('незмінний')
    await expect(
      db.serviceRecord.update({ where: { id: job.id }, data: { billedPartyId: null } })
    ).rejects.toThrow('незмінний')
    await db.servicePart.update({
      where: { id: snapshot.parts[0].id },
      data: { name: 'Later catalog name' },
    })
    await db.serviceLabor.update({
      where: { id: snapshot.labor[0].id },
      data: { executorName: 'Assigned later', executorFrozen: true },
    })
    await expect(
      db.servicePart.update({ where: { id: snapshot.parts[0].id }, data: { unitPrice: 11 } })
    ).rejects.toThrow('незмінні')
    await expect(db.servicePart.delete({ where: { id: snapshot.parts[0].id } })).rejects.toThrow(
      'незмінні'
    )
    expect(
      readFinancialSnapshot(
        (await db.serviceRecord.findUniqueOrThrow({ where: { id: job.id } }))
          .ledgerFinancialSnapshot
      )?.parts[0].name
    ).toBe('Original part')
    expect(readFinancialSnapshot(null)).toBeNull()
    expect(readFinancialSnapshot({ version: 1 })).toBeNull()
    expect(() => readFinancialSnapshot({ version: 2 })).toThrow('пошкоджено')
  })
  it('customer charge, payment and allocation preserve snapshot cents and reject duplication', async () => {
    const customer = await db.customer.create({
      data: { organizationId: org, userId: user, name: 'Customer' },
    })
    const job = await db.serviceRecord.create({
      data: {
        organizationId: org,
        customerId: customer.id,
        title: 'Charge',
        financeAccountingMode: 'LEDGER',
        totalAmount: 123.45,
      },
    })
    const input = {
      idempotencyKey: key(),
      serviceRecordId: job.id,
      customerId: customer.id,
      effectiveAt: date,
      dueDate: date,
    }
    const finance = createFinance(db, ctx),
      charge = await finance.issueCustomerCharge(input)
    expect(await finance.issueCustomerCharge(input)).toEqual(charge)
    expect(charge.amount).toBe('123.45')
    await expect(finance.issueCustomerCharge({ ...input, idempotencyKey: key() })).rejects.toThrow()
    const payment = await service.postMoneyTransaction({
      idempotencyKey: key(),
      partyId: charge.partyId,
      accountId,
      direction: 'IN',
      amount: '123.45',
      effectiveAt: date,
      method: 'bank',
    })
    await service.allocateSettlement({
      idempotencyKey: key(),
      debitEntryId: charge.id,
      creditEntryId: payment.entryId,
      amount: '123.45',
      effectiveAt: date,
    })
    expect(
      (await db.serviceRecord.findUniqueOrThrow({ where: { id: job.id } })).ledgerFinancialSnapshot
    ).toMatchObject({ total: '123.45', currency: 'UAH', entryId: charge.id })
    expect(
      (
        await db.cashLedgerEntry.findFirstOrThrow({ where: { moneyTransactionId: payment.id } })
      ).amountDelta.toFixed(2)
    ).toBe('123.45')
  })
  it('subcontract totals sum rounded lines and roll back all rows on invalid job', async () => {
    const supplier = await service.createSupplier({
      idempotencyKey: key(),
      name: key(),
      kind: 'SERVICES',
    })
    const job = await db.serviceRecord.create({
      data: { organizationId: org, title: 'Subcontract' },
    })
    const line = {
      serviceRecordId: job.id,
      description: 'Rounding',
      quantity: '1',
      unitCost: '0.005',
    }
    const input = {
      idempotencyKey: key(),
      supplierId: supplier.id,
      externalNumber: key(),
      effectiveAt: date,
      dueDate: date,
      lines: [line, line, line],
    }
    const result = await createFinance(db, ctx).postSubcontract(input)
    expect(result.total).toBe('0.03')
    const lines = await db.supplierServiceLine.findMany({ where: { documentId: result.id } })
    expect(lines.map((l) => l.totalAmount.toFixed(2))).toEqual(['0.01', '0.01', '0.01'])
    const before = await db.supplierServiceDocument.count({ where: { supplierId: supplier.id } })
    await expect(
      createFinance(db, ctx).postSubcontract({
        ...input,
        idempotencyKey: key(),
        externalNumber: key(),
        lines: [line, { ...line, serviceRecordId: 'missing' }],
      })
    ).rejects.toThrow()
    expect(await db.supplierServiceDocument.count({ where: { supplierId: supplier.id } })).toBe(
      before
    )
    await expect(
      createFinance(db, ctx).postSubcontract({
        ...input,
        idempotencyKey: key(),
        externalNumber: key(),
        lines: [{ ...line, unitCost: '0' }],
      })
    ).rejects.toThrow()
  })
  it('opening fractional stock matches rounded document value', async () => {
    const part = await db.inventoryPart.create({
      data: { organizationId: org, userId: user, name: 'Opening oil', unit: 'l' },
    })
    const doc = await createStockAdjustments(db, ctx).opening({
      idempotencyKey: key(),
      warehouseId,
      effectiveAt: date,
      reason: 'Verified opening',
      lines: [{ inventoryPartId: part.id, quantity: '3', unitPrice: '0.335' }],
    })
    const lot = await db.stockLot.findFirstOrThrow({
      where: { sourceLine: { documentId: doc.id } },
    })
    expect(await totals(lot.id)).toEqual({ quantity: '3.000', cost: '1.010000' })
    const balance = await db.stockLotBalance.findFirstOrThrow({ where: { lotId: lot.id } })
    await createStockAdjustments(db, ctx).adjust({
      idempotencyKey: key(),
      balanceId: balance.id,
      expectedVersion: balance.version,
      countedQuantity: '0',
      effectiveAt: date,
      reason: 'Verified shortage',
    })
    expect(await totals(lot.id)).toEqual({ quantity: '0.000', cost: '0.000000' })
  })
  it('allocation reversal restores exact capacity and rejects a second reversal', async () => {
    const { doc, supplier } = await receipt()
    const debit = await db.settlementEntry.findFirstOrThrow({
      where: { inventoryDocumentId: doc.id },
    })
    const payment = await service.postMoneyTransaction({
      idempotencyKey: key(),
      partyId: supplier.partyId,
      accountId,
      direction: 'OUT',
      amount: '1.01',
      effectiveAt: date,
      method: 'bank',
    })
    const result = await service.allocateSettlement({
      idempotencyKey: key(),
      debitEntryId: debit.id,
      creditEntryId: payment.entryId,
      amount: '1',
      effectiveAt: date,
    })
    const input = {
      idempotencyKey: key(),
      id: result.id,
      effectiveAt: date,
      reason: 'Wrong allocation',
    }
    const operations = createSettlementOperations(db, ctx)
    expect((await operations.reverseAllocation(input)).amount).toBe('1.00')
    await expect(
      operations.reverseAllocation({ ...input, idempotencyKey: key() })
    ).rejects.toThrow()
    await expect(
      service.allocateSettlement({
        idempotencyKey: key(),
        debitEntryId: debit.id,
        creditEntryId: payment.entryId,
        amount: '1.01',
        effectiveAt: date,
      })
    ).rejects.toThrow()
    await service.allocateSettlement({
      idempotencyKey: key(),
      debitEntryId: debit.id,
      creditEntryId: payment.entryId,
      amount: '1',
      effectiveAt: date,
    })
  })
  it('AC11 links subcontract to one work, freezes identity and leaves client price and stock intact', async () => {
    const supplier = await service.createSupplier({
      idempotencyKey: key(),
      name: 'Contractor',
      kind: 'SERVICES',
    })
    const job = await db.serviceRecord.create({
      data: { organizationId: org, title: 'Linked subcontract' },
    })
    const work = await db.serviceLabor.create({
      data: {
        serviceRecordId: job.id,
        description: 'External repair',
        executionType: 'SUBCONTRACT',
        total: 3800,
      },
    })
    const before = await db.inventoryLedgerEntry.count({ where: { organizationId: org } })
    const input = {
      idempotencyKey: key(),
      supplierId: supplier.id,
      externalNumber: key(),
      effectiveAt: date,
      dueDate: date,
      lines: [
        {
          serviceRecordId: job.id,
          serviceLaborId: work.id,
          description: 'External repair',
          quantity: '1',
          unitCost: '3000',
        },
      ],
    }
    const posted = await createFinance(db, ctx).postSubcontract(input)
    expect(posted.total).toBe('3000.00')
    expect(await db.inventoryLedgerEntry.count({ where: { organizationId: org } })).toBe(before)
    expect((await db.serviceLabor.findUniqueOrThrow({ where: { id: work.id } })).total).toBe(3800)
    expect(
      (
        await db.settlementEntry.findFirstOrThrow({
          where: { supplierServiceDocumentId: posted.id },
        })
      ).amount.toString()
    ).toBe('3000')
    await db.serviceLabor.update({
      where: { id: work.id },
      data: { description: 'Updated description' },
    })
    await expect(
      db.serviceLabor.update({ where: { id: work.id }, data: { executionType: 'INTERNAL' } })
    ).rejects.toThrow()
    await expect(db.serviceLabor.delete({ where: { id: work.id } })).rejects.toThrow()
    await expect(
      createFinance(db, ctx).postSubcontract({
        ...input,
        idempotencyKey: key(),
        lines: [{ ...input.lines[0], serviceLaborId: key() }],
      })
    ).rejects.toThrow()
  })

  it('payment drafts have no effect until posting, use revisions and remain idempotent', async () => {
    const supplier = await service.createSupplier({ idempotencyKey: key(), name: 'Draft payee' }),
      ops = paymentDraftOperations(db, ctx)
    const input = {
      idempotencyKey: key(),
      partyId: supplier.partyId,
      accountId,
      direction: 'OUT',
      amount: '0.01',
      effectiveAt: date,
      method: 'bank',
      note: 'Draft only',
    }
    const draft = await ops.save(input)
    expect(await ops.save(input)).toEqual(draft)
    expect(await db.cashLedgerEntry.count({ where: { moneyTransactionId: draft.id } })).toBe(0)
    expect(await db.settlementEntry.count({ where: { moneyTransactionId: draft.id } })).toBe(0)
    await expect(
      ops.save({ ...input, idempotencyKey: key(), documentId: draft.id, expectedVersion: 99 })
    ).rejects.toThrow('змінено')
    const changed = await ops.save({
      ...input,
      idempotencyKey: key(),
      documentId: draft.id,
      expectedVersion: 1,
      amount: '0.03',
    })
    const command = { idempotencyKey: key(), documentId: changed.id, expectedVersion: 2 },
      posted = await ops.post(command)
    expect(await ops.post(command)).toEqual(posted)
    expect(posted.id).toBe(draft.id)
    expect(
      (
        await db.cashLedgerEntry.findFirstOrThrow({ where: { moneyTransactionId: draft.id } })
      ).amountDelta.toString()
    ).toBe('-0.03')
    await expect(
      db.moneyTransaction.update({ where: { id: draft.id }, data: { amount: 99 } })
    ).rejects.toThrow()
    const cancelled = await ops.save({ ...input, idempotencyKey: key() })
    await ops.cancel({ idempotencyKey: key(), documentId: cancelled.id, expectedVersion: 1 })
    await expect(
      ops.post({ idempotencyKey: key(), documentId: cancelled.id, expectedVersion: 2 })
    ).rejects.toThrow()
    expect(await db.cashLedgerEntry.count({ where: { moneyTransactionId: cancelled.id } })).toBe(0)
  })
  it('full diagnostic reconciles source documents, cash, reserves and empty-lot values without writes', async () => {
    const before = await db.ledgerAuditEvent.count({ where: { organizationId: org } })
    expect(await db.$transaction((tx) => fullReconciliation(tx, ctx))).toEqual([])
    expect(await db.ledgerAuditEvent.count({ where: { organizationId: org } })).toBe(before)
  })
})
