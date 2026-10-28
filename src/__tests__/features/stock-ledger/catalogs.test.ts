import { productDetails } from '@/features/stock-ledger/Lib/productDetails'
import { supplierCard } from '@/features/stock-ledger/Lib/supplierCard'
import { randomUUID as key } from 'node:crypto'
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import {
  catalogOperations,
  assertProductQuantity,
  builtinPrecision,
} from '@/features/stock-ledger/Lib/catalogs'
import { createStockLedger } from '@/features/stock-ledger/Lib/service'
import { createStockOperations } from '@/features/stock-ledger/Lib/stock'
import { previewImport, importPage } from '@/features/stock-ledger/Lib/importService'
const url = process.env.LEDGER_TEST_DATABASE_URL
if (
  url &&
  !/^postgresql:\/\/[^@]+@(?:127\.0\.0\.1|localhost):\d+\/crm_ledger_test(?:\?|$)/.test(url)
)
  throw new Error('Isolated DB only')
;(url ? describe : describe.skip)('stock catalogs and preserved unit semantics', () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }),
    ctx = { organizationId: key(), userId: key() },
    catalog = catalogOperations(db, ctx),
    ledger = createStockLedger(db, ctx)
  let warehouseId: string, supplierId: string
  beforeAll(async () => {
    await db.user.create({
      data: { id: ctx.userId, name: 'Catalog test', email: ctx.userId + '@example.test' },
    })
    await db.organization.create({ data: { id: ctx.organizationId, name: 'Catalog test' } })
    warehouseId = (
      await ledger.createWarehouse({
        idempotencyKey: key(),
        code: 'CAT',
        name: 'Catalog warehouse',
      })
    ).id
    supplierId = (await ledger.createSupplier({ idempotencyKey: key(), name: 'Catalog supplier' }))
      .id
  })
  afterAll(() => db.$disconnect())
  const product = (extra = {}) =>
    db.inventoryPart.create({
      data: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        name: 'Catalog product',
        unit: 'pcs',
        ...extra,
      },
    })
  it('product and supplier cards preserve tenant boundaries and paginate source documents', async () => {
    const part = await product()
    const receipt = await ledger.saveReceiptDraft({
      idempotencyKey: key(),
      supplierId,
      warehouseId,
      effectiveAt: '2026-10-20',
      externalDate: '2026-10-20',
      dueDate: '2026-10-20',
      externalNumber: key(),
      lines: [{ inventoryPartId: part.id, quantity: '2', unitPrice: '10' }],
    })
    await ledger.postReceipt({ idempotencyKey: key(), documentId: receipt.id, expectedVersion: 1 })
    for (const tab of ['balances', 'lots', 'reservations']) {
      const result = await db.$transaction((tx) =>
        productDetails(tx, ctx, { productId: part.id, tab })
      )
      expect(result.total).toBe(tab === 'reservations' ? 0 : 1)
      if (tab !== 'reservations') expect(result.rows[0].quantity).toBe('2.000')
      expect(JSON.stringify(result)).not.toContain('unitCost')
    }
    for (const tab of ['receipts', 'services', 'orders', 'payments']) {
      const result = await db.$transaction((tx) => supplierCard(tx, ctx, { supplierId, tab }))
      expect(result.balance.debt).toBe('20.00')
      expect(result.total).toBe(tab === 'receipts' ? 1 : 0)
    }
    const next = await db.$transaction((tx) => supplierCard(tx, ctx, { supplierId, page: 2 }))
    expect(next.rows).toHaveLength(0)
    expect(next.total).toBe(1)
    await expect(
      db.$transaction((tx) => supplierCard(tx, { ...ctx, organizationId: key() }, { supplierId }))
    ).rejects.toThrow('не знайдений')
    await expect(
      db.$transaction((tx) =>
        productDetails(tx, { ...ctx, organizationId: key() }, { productId: part.id, tab: 'lots' })
      )
    ).rejects.toThrow('не знайдено')
  })
  it('custom precision governs drafts, lots and movements; unit and tracking become immutable with history', async () => {
    expect(builtinPrecision('шт.')).toBe(0)
    expect(builtinPrecision('л')).toBe(3)
    expect(builtinPrecision('custom')).toBeNull()
    await expect(
      catalog.unit({ idempotencyKey: key(), code: 'pcs', name: 'Pieces', precision: 3 })
    ).rejects.toThrow('стандартної')
    const unit = await catalog.unit({
      idempotencyKey: key(),
      code: 'dose',
      name: 'Measured dose',
      precision: 2,
    })
    const part = await product({ unit: 'dose', unitId: unit.id })
    const draft = {
      idempotencyKey: key(),
      supplierId,
      warehouseId,
      effectiveAt: '2026-10-20',
      externalDate: '2026-10-20',
      dueDate: '2026-10-20',
      externalNumber: key(),
      lines: [{ inventoryPartId: part.id, quantity: '1.234', unitPrice: '2.345678' }],
    }
    await expect(ledger.saveReceiptDraft(draft)).rejects.toThrow('2 знаки')
    const receipt = await ledger.saveReceiptDraft({
      ...draft,
      idempotencyKey: key(),
      lines: [{ ...draft.lines[0], quantity: '1.23' }],
    })
    await ledger.postReceipt({ idempotencyKey: key(), documentId: receipt.id, expectedVersion: 1 })
    await expect(
      db.inventoryPart.update({ where: { id: part.id }, data: { unit: 'kg' } })
    ).rejects.toThrow()
    await expect(
      db.inventoryPart.update({ where: { id: part.id }, data: { trackingMode: 'NON_STOCK' } })
    ).rejects.toThrow()
    await expect(
      catalog.unit({
        idempotencyKey: key(),
        id: unit.id,
        expectedVersion: 1,
        code: 'dose',
        name: 'Dose',
        precision: 1,
      })
    ).rejects.toThrow('історичними')
    await expect(
      db.unitOfMeasure.update({ where: { id: unit.id }, data: { precision: 1 } })
    ).rejects.toThrow()
    const archived = await catalog.unit({
      idempotencyKey: key(),
      id: unit.id,
      expectedVersion: 1,
      code: 'dose',
      name: 'Dose',
      precision: 2,
      archived: true,
    })
    expect(archived.version).toBe(2)
    await expect(
      db.$transaction((tx) => assertProductQuantity(tx, ctx, part, '1.00'))
    ).rejects.toThrow('архівовано')
    expect(await db.$transaction((tx) => assertProductQuantity(tx, ctx, part, '1.00', true))).toBe(
      2
    )
    const unknown = await product({ unit: 'unregistered' })
    await expect(
      db.$transaction((tx) => assertProductQuantity(tx, ctx, unknown, '1'))
    ).rejects.toThrow('Налаштуйте')
  })
  it('warehouse locations and product settings enforce tenant scope, versions, and non-stock completion', async () => {
    const unit = await catalog.unit({
      idempotencyKey: key(),
      code: 'pcs',
      name: 'Штуки',
      precision: 0,
    })
    const location = await catalog.location({
      idempotencyKey: key(),
      warehouseId,
      code: 'A-01',
      name: 'First shelf',
    })
    const part = await product()
    await catalog.product({
      idempotencyKey: key(),
      inventoryPartId: part.id,
      expectedUpdatedAt: part.updatedAt.toISOString(),
      unitId: unit.id,
      locationId: location.id,
      trackingMode: 'NON_STOCK',
    })
    const updated = await db.inventoryPart.findUniqueOrThrow({ where: { id: part.id } })
    expect(updated.locationId).toBe(location.id)
    await expect(
      catalog.product({
        idempotencyKey: key(),
        inventoryPartId: part.id,
        expectedUpdatedAt: part.updatedAt.toISOString(),
        unitId: unit.id,
        locationId: null,
        trackingMode: 'STOCK',
      })
    ).rejects.toThrow()
    await expect(
      catalog.location({
        idempotencyKey: key(),
        id: location.id,
        expectedVersion: 1,
        warehouseId,
        code: 'A-01',
        name: 'First shelf',
        archived: true,
      })
    ).rejects.toThrow('Спочатку')
    await expect(
      catalogOperations(db, { ...ctx, organizationId: key() }).product({
        idempotencyKey: key(),
        inventoryPartId: part.id,
        expectedUpdatedAt: updated.updatedAt.toISOString(),
        unitId: unit.id,
        locationId: null,
        trackingMode: 'STOCK',
      })
    ).rejects.toThrow()
    const job = await db.serviceRecord.create({
      data: {
        organizationId: ctx.organizationId,
        title: 'Non-stock job',
        inventoryAccountingMode: 'LEDGER',
        status: 'in-progress',
        partItems: {
          create: {
            name: 'Non-stock fee',
            inventoryPartId: part.id,
            quantity: 1,
            unitPrice: 10,
            total: 10,
          },
        },
      },
      include: { partItems: true },
    })
    await expect(
      createStockOperations(db, ctx).createDemand({
        idempotencyKey: key(),
        servicePartId: job.partItems[0].id,
      })
    ).rejects.toThrow('не ведеться')
    await db.serviceRecord.update({ where: { id: job.id }, data: { status: 'completed' } })
    expect(await db.stockDemand.count({ where: { serviceRecordId: job.id } })).toBe(0)
  })
  it('supplier SKU mappings participate in import without merging brands; preferred supplier and stale writes are explicit', async () => {
    const part = await product({ partNumber: 'MANUFACTURER-1' })
    const input = {
      idempotencyKey: key(),
      inventoryPartId: part.id,
      supplierId,
      expectedVersion: 0,
      supplierArticle: 'SUP-001',
      lastQuotedPrice: '12.345678',
      leadTimeDays: 2,
      preferred: true,
    }
    const mapped = await catalog.supplierProduct(input)
    expect(await catalog.supplierProduct(input)).toEqual(mapped)
    await expect(catalog.supplierProduct({ ...input, idempotencyKey: key() })).rejects.toThrow(
      'змінено'
    )
    const preview = await previewImport(db, ctx, {
      supplierId,
      name: 'supplier.csv',
      format: 'csv',
      bytes: Buffer.from('a;b;q;p\nSUP001;---;1;12.35'),
      mapping: { article: 'a', brand: 'b', quantity: 'q', unitPrice: 'p' },
    })
    const job = await db.ledgerImportJob.findUniqueOrThrow({ where: { id: preview.id } })
    const rows = importPage(job.mapping, 1).rows
    expect(rows[0].inventoryPartId).toBe(part.id)
    expect(rows[0].errors).toEqual([])
    const second = (await ledger.createSupplier({ idempotencyKey: key(), name: 'Second supplier' }))
      .id
    await catalog.supplierProduct({ ...input, idempotencyKey: key(), supplierId: second })
    expect(
      (await db.supplierProduct.findUniqueOrThrow({ where: { id: mapped.id } })).preferred
    ).toBe(false)
    expect(
      await db.supplierProduct.count({
        where: { organizationId: ctx.organizationId, inventoryPartId: part.id, preferred: true },
      })
    ).toBe(1)
    const before = await db.inventoryPart.findUniqueOrThrow({ where: { id: part.id } })
    expect(before.unitCost).toBe(0)
    await expect(
      catalogOperations(db, { ...ctx, organizationId: key() }).supplierProduct({
        ...input,
        idempotencyKey: key(),
      })
    ).rejects.toThrow()
  })
  it('a draft cannot post after the product unit changed; no stock or debt is partially written', async () => {
    const part = await product()
    const draft = await ledger.saveReceiptDraft({
      idempotencyKey: key(),
      supplierId,
      warehouseId,
      effectiveAt: '2026-10-20',
      externalDate: '2026-10-20',
      dueDate: '2026-10-20',
      externalNumber: key(),
      lines: [{ inventoryPartId: part.id, quantity: '1', unitPrice: '1' }],
    })
    await db.inventoryPart.update({ where: { id: part.id }, data: { unit: 'kg' } })
    await expect(
      ledger.postReceipt({ idempotencyKey: key(), documentId: draft.id, expectedVersion: 1 })
    ).rejects.toThrow('Одиниця товару змінилася')
    expect(await db.stockLot.count({ where: { inventoryPartId: part.id } })).toBe(0)
    expect(await db.settlementEntry.count({ where: { inventoryDocumentId: draft.id } })).toBe(0)
  })
})
