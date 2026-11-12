// @vitest-environment node
import { afterAll, expect, it, describe } from 'vitest'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import {
  draftSubcontractReceipts,
  assignReceiptService,
} from '@/features/receipts/subcontract-ledger'
import { DOCUMENT_LOCK_DEFAULTS } from '@/lib/document-lock'
import type { TxClient } from '@/lib/db'

const url = process.env.FINANCE_TEST_DATABASE_URL
describe.skipIf(!url)('subcontract services on PostgreSQL', () => {
  let db: PrismaClient
  afterAll(async () => {
    await db?.$disconnect()
  })
  it('groups pending work, survives concurrent retries, links existing receipts and keeps sale and cost separate', async () => {
    if (
      !url ||
      !['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
      !new URL(url).pathname.includes('test')
    )
      throw new Error('Expected local test database')
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
    const { id: org } = await db.organization.create({ data: { name: 'Subcontract test' } })
    const { id: order } = await db.serviceRecord.create({
      data: { organizationId: org, title: 'Order', status: 'pending' },
    })
    const suppliers = await Promise.all(
      ['A', 'B'].map((name) =>
        db.counterparty.create({ data: { organizationId: org, name, createdById: 'test' } })
      )
    )
    for (const supplier of [suppliers[0], suppliers[0], suppliers[1]]) {
      await db.serviceLabor.create({
        data: {
          serviceRecordId: order,
          description: 'Turning',
          hours: 1,
          rate: 1200,
          total: 1200,
          subcontract: { create: { supplierId: supplier.id, unitCost: '800.005' } },
        },
      })
    }
    const drafts = () =>
      db.$transaction((tx) => draftSubcontractReceipts(tx as TxClient, org, 'test', order))
    const [a, b] = await Promise.all([drafts(), drafts()])
    expect(a.sort()).toEqual(b.sort())
    const docs = await db.supplierReceipt.findMany({
      where: { organizationId: org },
      include: { lines: true, settlement: true },
    })
    expect(docs.map((d) => d.lines.length).sort()).toEqual([1, 2])
    expect(
      docs.every(
        (d) =>
          d.status === 'draft' &&
          !d.settlement &&
          d.lines.every((l) => l.amount.toString() === '800.01')
      )
    ).toBe(true)
    const receipt = await db.supplierReceipt.create({
      data: {
        organizationId: org,
        supplierId: suppliers[0].id,
        number: 'external',
        status: 'posted',
        createdById: 'test',
        documentDate: new Date(),
        receivedDate: new Date(),
        lines: {
          create: {
            position: 0,
            kind: 'service',
            name: 'Testing',
            unit: 'service',
            quantity: 2,
            unitPrice: 300,
            amount: 600,
          },
        },
      },
      include: { lines: true },
    })
    const attach = () =>
      db.$transaction((tx) =>
        assignReceiptService(
          tx as TxClient,
          org,
          order,
          receipt.lines[0].id,
          null,
          '550',
          DOCUMENT_LOCK_DEFAULTS
        )
      )
    await attach()
    await attach()
    const linked = await db.subcontractWork.findUniqueOrThrow({
      where: { receiptLineId: receipt.lines[0].id },
      include: { labor: true },
    })
    expect(linked.unitCost.toString()).toBe('300')
    expect(linked.labor.total).toBe(1100)
    expect(await db.stockMovement.count({ where: { organizationId: org } })).toBe(0)
  })
})
