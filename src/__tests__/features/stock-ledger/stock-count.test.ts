// @vitest-environment node
import { randomUUID as key } from 'node:crypto'
import { afterAll, describe, it, expect } from 'vitest'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { createStockLedger } from '@/features/stock-ledger/Lib/service'
import { createStockAdjustments } from '@/features/stock-ledger/Lib/adjustments'
import { stockCountOperations } from '@/features/stock-ledger/Lib/stockCount'
const url = process.env.LEDGER_TEST_DATABASE_URL
if (
  url &&
  !/^postgresql:\/\/[^@]+@(?:127\.0\.0\.1|localhost):\d+\/crm_ledger_test(?:\?|$)/.test(url)
)
  throw new Error('Use isolated local crm_ledger_test')
;(url ? describe : describe.skip)('stock count documents', () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  afterAll(() => db.$disconnect())
  async function fixture() {
    const org = key(),
      user = key(),
      ctx = { organizationId: org, userId: user },
      date = '2026-10-23'
    await db.user.create({ data: { id: user, email: user + '@example.test', name: 'Count test' } })
    await db.organization.create({ data: { id: org, name: 'Count test' } })
    const w = await createStockLedger(db, ctx).createWarehouse({
      idempotencyKey: key(),
      code: 'MAIN',
      name: 'Main',
    })
    const p = await db.inventoryPart.create({
      data: {
        organizationId: org,
        userId: user,
        name: 'Count product',
        partNumber: 'COUNT',
        unit: 'pcs',
      },
    })
    await createStockAdjustments(db, ctx).opening({
      idempotencyKey: key(),
      warehouseId: w.id,
      effectiveAt: date,
      reason: 'Test opening',
      lines: [{ inventoryPartId: p.id, quantity: '10', unitPrice: '1.335' }],
    })
    const ops = stockCountOperations(db, ctx),
      count = await ops.start({
        idempotencyKey: key(),
        warehouseId: w.id,
        effectiveAt: date,
        reason: 'Physical stock check',
      })
    const line = await db.ledgerStockCountLine.findFirstOrThrow({ where: { countId: count.id } })
    const save = (qty: string) =>
      ops.save({
        idempotencyKey: key(),
        documentId: count.id,
        expectedVersion: 1,
        lines: [
          {
            id: line.id,
            inventoryPartId: p.id,
            countedQty: qty,
            reason: 'Physical stock difference',
          },
        ],
      })
    return { org, ctx, w, p, ops, count, line, save, date }
  }
  it('draft has no effect, shortage posts exact carrying value once and becomes immutable', async () => {
    const f = await fixture()
    await f.save('7')
    expect(await db.inventoryLedgerEntry.count({ where: { organizationId: f.org } })).toBe(1)
    const command = { idempotencyKey: key(), documentId: f.count.id, expectedVersion: 2 }
    const result = await f.ops.post(command)
    expect(await f.ops.post(command)).toEqual(result)
    const balance = await db.stockLotBalance.findFirstOrThrow({ where: { organizationId: f.org } })
    expect(balance.onHandQty.toString()).toBe('7')
    const sum = await db.inventoryLedgerEntry.aggregate({
      where: { organizationId: f.org },
      _sum: { costAmountDelta: true },
    })
    expect(sum._sum.costAmountDelta?.toString()).toBe('9.345')
    expect(await db.settlementEntry.count({ where: { organizationId: f.org } })).toBe(0)
    await expect(
      db.ledgerStockCountLine.update({ where: { id: f.line.id }, data: { countedQty: 9 } })
    ).rejects.toThrow()
    await expect(
      f.ops.save({ idempotencyKey: key(), documentId: f.count.id, expectedVersion: 3, lines: [] })
    ).rejects.toThrow()
  })
  it('unknown surplus requires explicit valuation, preserves rounding and creates no supplier debt', async () => {
    const f = await fixture()
    await f.ops.save({
      idempotencyKey: key(),
      documentId: f.count.id,
      expectedVersion: 1,
      lines: [
        { id: f.line.id, inventoryPartId: f.p.id, countedQty: '10' },
        {
          inventoryPartId: f.p.id,
          countedQty: '3',
          confirmedUnitCost: '0.335',
          reason: 'Found unrecorded units',
        },
      ],
    })
    await f.ops.post({ idempotencyKey: key(), documentId: f.count.id, expectedVersion: 2 })
    const sum = await db.inventoryLedgerEntry.aggregate({
      where: { organizationId: f.org },
      _sum: { quantityDelta: true, costAmountDelta: true },
    })
    expect(sum._sum.quantityDelta?.toString()).toBe('13')
    expect(sum._sum.costAmountDelta?.toString()).toBe('14.36')
    expect(await db.settlementEntry.count({ where: { organizationId: f.org } })).toBe(0)
  })
  it('requires all counts and reasons, disallows fractional pieces and foreign lines', async () => {
    const f = await fixture()
    await expect(
      f.ops.post({ idempotencyKey: key(), documentId: f.count.id, expectedVersion: 1 })
    ).rejects.toThrow('Порахуйте')
    await expect(f.save('1.5')).rejects.toThrow('цілої')
    for (const line of [
      { id: f.line.id, inventoryPartId: f.p.id, countedQty: '2' },
      { id: key(), inventoryPartId: f.p.id, countedQty: '2', reason: 'Unknown line' },
      { inventoryPartId: f.p.id, countedQty: '2', reason: 'No valuation' },
    ]) {
      await expect(
        f.ops.save({
          idempotencyKey: key(),
          documentId: f.count.id,
          expectedVersion: 1,
          lines: [line],
        })
      ).rejects.toThrow()
    }
    expect(
      (await db.ledgerStockCount.findUniqueOrThrow({ where: { id: f.count.id } })).version
    ).toBe(1)
  })
  it('rejects movements since snapshot atomically', async () => {
    const f = await fixture()
    await f.save('9')
    await db.stockLotBalance.updateMany({
      where: { organizationId: f.org },
      data: { version: { increment: 1 } },
    })
    const before = await db.inventoryDocument.count({ where: { organizationId: f.org } })
    await expect(
      f.ops.post({ idempotencyKey: key(), documentId: f.count.id, expectedVersion: 2 })
    ).rejects.toThrow('Після зрізу')
    expect(await db.inventoryDocument.count({ where: { organizationId: f.org } })).toBe(before)
  })
  it('cancel is terminal; tenant cannot access another count', async () => {
    const f = await fixture()
    await expect(
      stockCountOperations(db, { ...f.ctx, organizationId: key() }).cancel({
        idempotencyKey: key(),
        documentId: f.count.id,
        expectedVersion: 1,
      })
    ).rejects.toThrow()
    await f.ops.cancel({ idempotencyKey: key(), documentId: f.count.id, expectedVersion: 1 })
    await expect(f.save('10')).rejects.toThrow()
    expect(await db.inventoryLedgerEntry.count({ where: { organizationId: f.org } })).toBe(1)
  })
})
