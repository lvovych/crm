// @vitest-environment node
import { afterAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { importReceiptDraft, queueReceiptImport } from '@/features/receipts/import-service'
import { saveReceiptDraft } from '@/features/receipts/save-ledger'

vi.mock('@/lib/db', async () => {
  const { PrismaClient } = await import('@/generated/prisma/client')
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const url = process.env.FINANCE_TEST_DATABASE_URL
  if (
    url &&
    (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
      !new URL(url).pathname.endsWith('_test'))
  )
    throw new Error('Local test database required')
  return {
    db: new PrismaClient({
      adapter: new PrismaPg({ connectionString: url || 'postgresql://localhost/unused_test' }),
    }),
  }
})

describe.skipIf(!process.env.FINANCE_TEST_DATABASE_URL).each(['ukrcar', 'bm-parts'] as const)(
  '%s import on PostgreSQL',
  (source) => {
    afterAll(async () => db.$disconnect())
    async function fixture() {
      const org = await db.organization.create({ data: { name: 'UkrCar import test' } })
      const user = await db.user.create({
        data: { name: 'Test', email: `${randomUUID()}@example.test` },
      })
      const supplier = await db.counterparty.create({
        data: {
          name: 'UkrCar',
          organizationId: org.id,
          createdById: user.id,
          supplierProfile: { create: {} },
        },
      })
      const connection = await db.integrationConnection.create({
        data: {
          organizationId: org.id,
          connectorId: source,
          createdById: user.id,
          status: 'active',
        },
      })
      const receipt = {
        number: '9000388299',
        externalId: '234928',
        date: '2026-11-18',
        url: 'https://ukrcar.ua/uk/accounting/transactions/234928/',
        lines: [
          {
            brand: 'ELRING',
            article: '458.580',
            name: 'Gasket',
            quantity: '2',
            unitPrice: '125.50',
            amount: '251.00',
          },
        ],
      }
      const input = {
        source,
        organizationId: org.id,
        supplierId: supplier.id,
        userId: user.id,
        connectionId: connection.id,
        runId: randomUUID(),
        receivedDate: '2026-11-19',
        receipt,
      }
      return { input, save: () => db.$transaction((tx) => importReceiptDraft(tx, input)) }
    }
    it('concurrent imports create one draft with lines and no stock or settlement entries', async () => {
      const f = await fixture()
      const result = await Promise.all([f.save(), f.save()])
      expect(result.filter((r) => r.created)).toHaveLength(1)
      expect(result[0].id).toBe(result[1].id)
      const document = await db.supplierReceipt.findUniqueOrThrow({
        where: { id: result[0].id },
        include: { lines: true },
      })
      expect(document.status).toBe('draft')
      expect(document.source).toBe(source)
      expect(document.lines[0].brandSnapshot).toBe('ELRING')
      expect(document.lines[0].partId).toBeNull()
      expect(document.lines[0].amount.toString()).toBe('251')
      expect(
        await db.stockMovement.count({ where: { organizationId: f.input.organizationId } })
      ).toBe(0)
      expect(
        await db.supplierEntry.count({ where: { organizationId: f.input.organizationId } })
      ).toBe(0)
      expect(
        await db.inventoryPart.count({ where: { organizationId: f.input.organizationId } })
      ).toBe(0)
    })
    it('recognises manually created numbers even with another date and remote ID', async () => {
      const f = await fixture()
      const existing = await db.supplierReceipt.create({
        data: {
          organizationId: f.input.organizationId,
          supplierId: f.input.supplierId,
          createdById: f.input.userId,
          number: f.input.receipt.number,
          documentDate: new Date('2026-01-01'),
          receivedDate: new Date('2026-01-01'),
        },
      })
      expect(await f.save()).toEqual({ id: existing.id, created: false })
      expect(await db.supplierReceiptLine.count({ where: { receiptId: existing.id } })).toBe(0)
    })
    it('manual draft creation also treats the number as unique independently of date', async () => {
      const f = await fixture()
      const first = await f.save()
      const result = await db.$transaction((tx) =>
        saveReceiptDraft(
          tx,
          f.input.organizationId,
          f.input.userId,
          {
            id: randomUUID(),
            version: 0,
            supplierId: f.input.supplierId,
            number: f.input.receipt.number,
            documentDate: '2026-01-01',
            receivedDate: '2026-01-01',
            lines: [
              {
                kind: 'service',
                name: 'Test',
                unit: 'service',
                partId: null,
                quantity: '1',
                unitPrice: '1',
              },
            ],
          },
          false,
          false
        )
      )
      expect(result).toEqual({ id: first.id, duplicate: true })
    })
    it('coalesces concurrent clicks and an already running job', async () => {
      const f = await fixture()
      const queue = () =>
        queueReceiptImport(f.input.connectionId, f.input.organizationId, f.input.userId, {
          from: '2026-11-06',
          to: '2026-11-19',
        })
      const ids = await Promise.all([queue(), queue(), queue()])
      expect(new Set(ids).size).toBe(1)
      await db.integrationJob.update({ where: { id: ids[0] }, data: { status: 'running' } })
      expect(await queue()).toBe(ids[0])
      await db.integrationJob.update({ where: { id: ids[0] }, data: { status: 'done' } })
      expect(await queue()).not.toBe(ids[0])
    })
    it('rolls back the entire document on a failed line and isolates organisations', async () => {
      const f = await fixture()
      f.input.receipt.lines[0].quantity = 'invalid'
      await expect(f.save()).rejects.toThrow()
      expect(
        await db.supplierReceipt.count({ where: { organizationId: f.input.organizationId } })
      ).toBe(0)
      const another = await fixture()
      f.input.receipt.lines[0].quantity = '2'
      await f.save()
      expect((await another.save()).created).toBe(true)
    })
  }
)
