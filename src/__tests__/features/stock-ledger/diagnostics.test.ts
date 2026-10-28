import { randomUUID as key } from 'node:crypto'
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { createStockLedger } from '@/features/stock-ledger/Lib/service'
import { runLedgerDiagnostic } from '@/features/stock-ledger/Lib/diagnostics'
const url = process.env.LEDGER_TEST_DATABASE_URL
if (
  url &&
  !/^postgresql:\/\/[^@]+@(?:127\.0\.0\.1|localhost):\d+\/crm_ledger_test(?:\?|$)/.test(url)
)
  throw new Error('Isolated DB only')
;(url ? describe : describe.skip)('readonly daily diagnostic', () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }),
    ctx = { organizationId: key(), userId: key() }
  let balanceId: string
  beforeAll(async () => {
    await db.user.create({
      data: { id: ctx.userId, name: 'Diagnostic', email: ctx.userId + '@example.test' },
    })
    await db.organization.create({ data: { id: ctx.organizationId, name: 'Diagnostic' } })
    const service = createStockLedger(db, ctx),
      supplier = await service.createSupplier({ idempotencyKey: key(), name: 'S' }),
      warehouse = await service.createWarehouse({ idempotencyKey: key(), name: 'W', code: 'W' }),
      part = await db.inventoryPart.create({
        data: { organizationId: ctx.organizationId, userId: ctx.userId, name: 'P', unit: 'pcs' },
      })
    const draft = await service.saveReceiptDraft({
      idempotencyKey: key(),
      supplierId: supplier.id,
      warehouseId: warehouse.id,
      effectiveAt: '2026-10-20',
      externalDate: '2026-10-20',
      dueDate: '2026-10-20',
      externalNumber: 'D',
      lines: [{ inventoryPartId: part.id, quantity: '1', unitPrice: '1' }],
    })
    await service.postReceipt({ idempotencyKey: key(), documentId: draft.id, expectedVersion: 1 })
    balanceId = (
      await db.stockLotBalance.findFirstOrThrow({ where: { organizationId: ctx.organizationId } })
    ).id
  })
  afterAll(() => db.$disconnect())
  it('reports, deduplicates and never repairs a projection or changes financial sources', async () => {
    const day = (n: number) => new Date(`2026-10-${n}T05:00:00Z`)
    expect((await runLedgerDiagnostic(db, ctx, day(21))).count).toBe(0)
    const before = await db.inventoryLedgerEntry.count({
        where: { organizationId: ctx.organizationId },
      }),
      settlements = await db.settlementEntry.count({
        where: { organizationId: ctx.organizationId },
      })
    await db.stockLotBalance.update({
      where: { id: balanceId },
      data: { onHandQty: 2, version: { increment: 1 } },
    })
    const result = await runLedgerDiagnostic(db, ctx, day(22))
    expect(result.count).toBeGreaterThan(0)
    expect(result.notified).toBe(true)
    expect((await runLedgerDiagnostic(db, ctx, day(22))).notified).toBe(false)
    expect((await runLedgerDiagnostic(db, ctx, day(23))).notified).toBe(false)
    expect(await db.notification.count({ where: { organizationId: ctx.organizationId } })).toBe(1)
    expect(
      (
        await db.stockLotBalance.findUniqueOrThrow({ where: { id: balanceId } })
      ).onHandQty.toString()
    ).toBe('2')
    expect(
      await db.inventoryLedgerEntry.count({ where: { organizationId: ctx.organizationId } })
    ).toBe(before)
    expect(await db.settlementEntry.count({ where: { organizationId: ctx.organizationId } })).toBe(
      settlements
    )
    await db.stockLotBalance.update({
      where: { id: balanceId },
      data: { onHandQty: 1, version: { increment: 1 } },
    })
    expect((await runLedgerDiagnostic(db, ctx, day(24))).count).toBe(0)
  })
})
