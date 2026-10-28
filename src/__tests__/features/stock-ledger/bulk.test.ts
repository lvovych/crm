// @vitest-environment node
import { randomUUID as key } from 'node:crypto'
import { afterAll, describe, it, expect } from 'vitest'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { createStockLedger } from '@/features/stock-ledger/Lib/service'
import { createStockAdjustments } from '@/features/stock-ledger/Lib/adjustments'
import { bulkStockOperation, previewBulkStock } from '@/features/stock-ledger/Lib/bulk'
const url = process.env.LEDGER_TEST_DATABASE_URL
if (
  url &&
  !/^postgresql:\/\/[^@]+@(?:127\.0\.0\.1|localhost):\d+\/crm_ledger_test(?:\?|$)/.test(url)
)
  throw new Error('Use isolated local DB')
;(url ? describe : describe.skip)('atomic bulk fulfillment', () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  afterAll(() => db.$disconnect())
  async function setup() {
    const org = key(),
      user = key(),
      ctx = { organizationId: org, userId: user },
      date = '2026-10-23'
    await db.user.create({ data: { id: user, email: user + '@example.test', name: 'Bulk' } })
    await db.organization.create({ data: { id: org, name: 'Bulk' } })
    const service = createStockLedger(db, ctx),
      w = await service.createWarehouse({ idempotencyKey: key(), code: 'MAIN', name: 'Main' }),
      supplier = await service.createSupplier({ idempotencyKey: key(), name: 'Bulk supplier' })
    const p = await db.inventoryPart.create({
      data: { organizationId: org, userId: user, name: 'Bulk part', unit: 'pcs' },
    })
    await createStockAdjustments(db, ctx).opening({
      idempotencyKey: key(),
      warehouseId: w.id,
      effectiveAt: date,
      reason: 'Opening fixture',
      lines: [{ inventoryPartId: p.id, quantity: '10', unitPrice: '0.335' }],
    })
    const job = await db.serviceRecord.create({
      data: {
        organizationId: org,
        title: 'Bulk job',
        status: 'in-progress',
        inventoryAccountingMode: 'LEDGER',
        partItems: {
          create: [
            { name: 'First', inventoryPartId: p.id, quantity: 6 },
            { name: 'Second', inventoryPartId: p.id, quantity: 6 },
          ],
        },
      },
      include: { partItems: true },
    })
    return {
      org,
      ctx,
      job,
      supplier,
      input: {
        idempotencyKey: key(),
        operation: 'reserve',
        warehouseId: w.id,
        effectiveAt: date,
        lines: job.partItems.map((p) => ({ servicePartId: p.id, quantity: '6' })),
      },
    }
  }
  it('later shortage rolls back earlier rows, demands, audit and reservations', async () => {
    const f = await setup()
    await expect(bulkStockOperation(db, f.ctx, f.input)).rejects.toThrow()
    expect(await db.stockReservation.count({ where: { organizationId: f.org } })).toBe(0)
    expect(await db.stockDemand.count({ where: { organizationId: f.org } })).toBe(0)
    expect(
      (
        await db.stockLotBalance.findFirstOrThrow({ where: { organizationId: f.org } })
      ).reservedQty.toString()
    ).toBe('0')
  })
  it('preview has zero durable effects, confirmation is atomic and idempotent, issue consumes all reservations', async () => {
    const f = await setup(),
      input = { ...f.input, lines: f.input.lines.map((l) => ({ ...l, quantity: '3' })) }
    const preview = await previewBulkStock(db, f.ctx, input)
    expect(preview.rows).toHaveLength(2)
    expect(await db.stockDemand.count({ where: { organizationId: f.org } })).toBe(0)
    const posted = await bulkStockOperation(db, f.ctx, input)
    expect(await bulkStockOperation(db, f.ctx, input)).toEqual(posted)
    expect(
      (
        await db.stockLotBalance.findFirstOrThrow({ where: { organizationId: f.org } })
      ).reservedQty.toString()
    ).toBe('6')
    await bulkStockOperation(db, f.ctx, { ...input, idempotencyKey: key(), operation: 'issue' })
    const balance = await db.stockLotBalance.findFirstOrThrow({ where: { organizationId: f.org } })
    expect(balance.onHandQty.toString()).toBe('4')
    expect(balance.reservedQty.toString()).toBe('0')
  })
  it('bulk purchase creates one draft; foreign rows and duplicates fail', async () => {
    const f = await setup(),
      input = { ...f.input, operation: 'purchase', supplierId: f.supplier.id }
    const r = await bulkStockOperation(db, f.ctx, input)
    expect(r.purchaseId).toBeTruthy()
    expect(await db.purchaseOrder.count({ where: { organizationId: f.org } })).toBe(1)
    expect(await db.inventoryLedgerEntry.count({ where: { organizationId: f.org } })).toBe(1)
    await expect(
      bulkStockOperation(db, { ...f.ctx, organizationId: key() }, input)
    ).rejects.toThrow()
    await expect(
      bulkStockOperation(db, f.ctx, {
        ...input,
        idempotencyKey: key(),
        lines: [input.lines[0], input.lines[0]],
      })
    ).rejects.toThrow()
  })
})
