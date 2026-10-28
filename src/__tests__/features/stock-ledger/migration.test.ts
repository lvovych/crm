import { readLedgerCustomerTotals } from '@/features/stock-ledger/Lib/customerReadModel'
import { randomUUID as key } from 'node:crypto'
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { createStockLedger } from '@/features/stock-ledger/Lib/service'
import { createStockOperations } from '@/features/stock-ledger/Lib/stock'
import { applyMigrationBatch, migrationChecksum } from '@/features/stock-ledger/Lib/migrationBatch'
import { newRecordFinanceMode, newRecordStockMode } from '@/features/stock-ledger/Lib/cutover'
import {
  customerBalance,
  chargeCompletedRecord,
  postCustomerAdjustment,
} from '@/features/stock-ledger/Lib/customerFinance'
const url = process.env.LEDGER_TEST_DATABASE_URL
if (
  url &&
  !/^postgresql:\/\/[^@]+@(?:127\.0\.0\.1|localhost):\d+\/crm_ledger_test(?:\?|$)/.test(url)
)
  throw new Error('Isolated DB only')
;(url ? describe : describe.skip)('verified migration package', () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  beforeAll(() => {
    process.env.STOCK_LEDGER_ENABLED = 'true'
  })
  afterAll(() => db.$disconnect())
  async function setup() {
    const ctx = { organizationId: key(), userId: key() }
    await db.user.create({
      data: { id: ctx.userId, name: 'Migration', email: ctx.userId + '@example.test' },
    })
    await db.organization.create({ data: { id: ctx.organizationId, name: 'Migration' } })
    const ledger = createStockLedger(db, ctx),
      warehouse = await ledger.createWarehouse({
        idempotencyKey: key(),
        code: 'M',
        name: 'Warehouse',
      }),
      product = await db.inventoryPart.create({
        data: {
          organizationId: ctx.organizationId,
          userId: ctx.userId,
          name: 'Part',
          quantity: 5,
          unit: 'pcs',
        },
      }),
      customer = await db.customer.create({
        data: { organizationId: ctx.organizationId, userId: ctx.userId, name: 'Customer' },
      })
    const job = await db.serviceRecord.create({
      data: {
        organizationId: ctx.organizationId,
        title: 'Historical active',
        status: 'in-progress',
        customerId: customer.id,
        totalAmount: 100,
        subtotal: 100,
        partItems: {
          create: {
            inventoryPartId: product.id,
            name: 'Part',
            quantity: 2,
            unitPrice: 50,
            total: 100,
          },
        },
      },
      include: { partItems: true },
    })
    await db.payment.create({
      data: { serviceRecordId: job.id, amount: 30, method: 'cash', date: new Date('2026-10-19') },
    })
    const manifest = {
      version: 1,
      effectiveDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(
        new Date()
      ),
      sourceChecksum: 'a'.repeat(64),
      stock: [
        {
          warehouseId: warehouse.id,
          lines: [
            {
              inventoryPartId: product.id,
              quantity: '5',
              unitPrice: '10',
              expectedLegacyQuantity: '5',
            },
          ],
        },
      ],
      balances: [],
      jobs: [
        {
          id: job.id,
          expectedUpdatedAt: job.updatedAt.toISOString(),
          expectedTotal: '100',
          expectedPaid: '30',
          expectedManuallyPaid: false,
          parts: [
            {
              servicePartId: job.partItems[0].id,
              issuedQuantity: '2',
              unitCost: '10',
              warehouseId: warehouse.id,
            },
          ],
        },
      ],
      activate: true,
    }
    return { ctx, manifest, job, warehouse, product }
  }
  it('dry run rolls back, replay is a no-op, old issue does not consume opening and old payments create no cash', async () => {
    const { ctx, manifest, job, warehouse, product } = await setup(),
      input = {
        idempotencyKey: key(),
        manifest,
        checksum: migrationChecksum(manifest),
        confirmed: true,
      }
    const preview = await applyMigrationBatch(db, ctx, input, true)
    expect(preview).toHaveProperty('preview', true)
    expect(
      await db.ledgerMigrationBatch.count({ where: { organizationId: ctx.organizationId } })
    ).toBe(0)
    expect(
      (await db.serviceRecord.findUniqueOrThrow({ where: { id: job.id } })).financeAccountingMode
    ).toBe('LEGACY')
    const result = await applyMigrationBatch(db, ctx, input)
    expect(await applyMigrationBatch(db, ctx, input)).toEqual(result)
    expect(await applyMigrationBatch(db, ctx, { ...input, idempotencyKey: key() })).toHaveProperty(
      'alreadyApplied',
      true
    )
    expect(
      (
        await db.stockLotBalance.aggregate({
          where: { organizationId: ctx.organizationId },
          _sum: { onHandQty: true },
        })
      )._sum.onHandQty?.toString()
    ).toBe('5')
    expect(
      await db.inventoryLedgerEntry.count({ where: { organizationId: ctx.organizationId } })
    ).toBe(1)
    expect(await db.cashLedgerEntry.count({ where: { organizationId: ctx.organizationId } })).toBe(
      0
    )
    expect(await db.payment.count({ where: { serviceRecordId: job.id } })).toBe(1)
    expect((await db.inventoryPart.findUniqueOrThrow({ where: { id: product.id } })).quantity).toBe(
      5
    )
    const balance = await db.$transaction((tx) => customerBalance(tx, ctx, job.id))
    expect(balance.debt).toBe('70.00')
    expect((await readLedgerCustomerTotals(db, ctx.organizationId, [job.id])).get(job.id)).toEqual({
      total: '100.00',
      paid: '30.00',
      debt: '70.00',
    })
    expect((await readLedgerCustomerTotals(db, key(), [job.id])).size).toBe(0)
    expect((await readLedgerCustomerTotals(db, ctx.organizationId, [])).size).toBe(0)
    expect(await newRecordStockMode(db, ctx.organizationId)).toBe('LEDGER')
    expect(await newRecordFinanceMode(db, ctx.organizationId)).toBe('LEDGER')
    await expect(
      db.inventoryPart.update({ where: { id: product.id }, data: { quantity: 99 } })
    ).rejects.toThrow()
    expect((await db.inventoryPart.findUniqueOrThrow({ where: { id: product.id } })).quantity).toBe(
      5
    )
    await db.serviceRecord.update({ where: { id: job.id }, data: { status: 'completed' } })
    const source = await db.documentLotAllocation.findFirstOrThrow({
      where: { organizationId: ctx.organizationId },
    })
    await createStockOperations(db, ctx).returnFromWorkOrder({
      idempotencyKey: key(),
      allocationId: source.id,
      warehouseId: warehouse.id,
      quantity: '1',
      effectiveAt: manifest.effectiveDate,
      reason: 'Physical return',
    })
    expect(
      (
        await db.stockLotBalance.aggregate({
          where: { organizationId: ctx.organizationId },
          _sum: { onHandQty: true },
        })
      )._sum.onHandQty?.toString()
    ).toBe('6')
    expect((await db.$transaction((tx) => customerBalance(tx, ctx, job.id))).debt).toBe('70.00')
  })
  it('stale balances, altered checksum, missing part mapping or edited payments roll back the entire package', async () => {
    const { ctx, manifest, job } = await setup()
    const input = { idempotencyKey: key(), manifest, checksum: 'b'.repeat(64), confirmed: true }
    await expect(applyMigrationBatch(db, ctx, input)).rejects.toThrow('сума')
    manifest.jobs[0].parts = []
    input.checksum = migrationChecksum(manifest)
    await expect(applyMigrationBatch(db, ctx, input)).rejects.toThrow('деталь')
    expect(
      await db.inventoryDocument.count({ where: { organizationId: ctx.organizationId } })
    ).toBe(0)
    manifest.jobs[0].expectedPaid = '31'
    input.checksum = migrationChecksum(manifest)
    await expect(applyMigrationBatch(db, ctx, input)).rejects.toThrow('змінилися')
    expect(
      (await db.serviceRecord.findUniqueOrThrow({ where: { id: job.id } })).inventoryAccountingMode
    ).toBe('LEGACY')
  })
  it('zero-value completed invoice freezes without fictitious entries and supports later debit correction', async () => {
    const { ctx, job } = await setup()
    const free = await db.serviceRecord.create({
      data: {
        organizationId: ctx.organizationId,
        customerId: job.customerId,
        title: 'Warranty',
        financeAccountingMode: 'LEDGER',
        status: 'completed',
        totalAmount: 0,
      },
    })
    await db.$transaction((tx) => chargeCompletedRecord(tx, ctx.organizationId, free, ctx.userId))
    expect(await db.settlementEntry.count({ where: { serviceRecordId: free.id } })).toBe(0)
    expect(
      (await readLedgerCustomerTotals(db, ctx.organizationId, [free.id])).get(free.id)
    ).toEqual({ total: '0.00', paid: '0.00', debt: '0.00' })
    expect((await db.$transaction((tx) => customerBalance(tx, ctx, free.id))).issued).toBe(true)
    await expect(
      db.serviceRecord.update({ where: { id: free.id }, data: { totalAmount: 1 } })
    ).rejects.toThrow()
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date())
    await postCustomerAdjustment(db, ctx, {
      idempotencyKey: key(),
      serviceRecordId: free.id,
      kind: 'DEBIT',
      amount: '1.01',
      effectiveAt: day,
      reason: 'Approved added service',
      confirmed: true,
    })
    expect(
      (await readLedgerCustomerTotals(db, ctx.organizationId, [free.id])).get(free.id)?.debt
    ).toBe('1.01')
  })
})
