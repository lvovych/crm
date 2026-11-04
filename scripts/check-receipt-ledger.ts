// Run against a seeded, disposable local database with node --env-file=.env --import tsx.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { transitionReceipt } from '../src/features/receipts/ledger'
import { reconcileInventoryForParts } from '../src/features/inventory/Lib/reconcileStock'

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
}).$extends({ query: {} })

async function check() {
  const url = new URL(process.env.DATABASE_URL ?? '')
  assert(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_test'))
  const owner = await db.organizationMember.findFirstOrThrow({ where: { role: 'owner' } })
  const { organizationId, userId } = owner
  const run = randomUUID()
  const supplier = await db.counterparty.create({
    data: {
      organizationId,
      createdById: userId,
      name: 'Test ' + run,
      supplierProfile: { create: {} },
    },
  })
  const parts = await Promise.all(
    ['a', 'b'].map((suffix) =>
      db.inventoryPart.create({
        data: { id: run + suffix, userId, organizationId, name: suffix, unit: 'l', quantity: 3 },
      })
    )
  )
  const doc = await db.supplierReceipt.create({
    data: {
      organizationId,
      supplierId: supplier.id,
      number: run,
      createdById: userId,
      documentDate: new Date(),
      receivedDate: new Date(),
      lines: {
        create: [
          ...parts.map((part, position) => ({
            position,
            kind: 'part',
            partId: part.id,
            name: part.name,
            unit: 'l',
            quantity: 0.5,
            unitPrice: 200,
            amount: 100,
          })),
          {
            position: 2,
            kind: 'service',
            name: 'delivery',
            unit: 'service',
            quantity: 1,
            unitPrice: 150,
            amount: 150,
          },
        ],
      },
    },
  })
  const change = (org: string, v: number, target: 'posted' | 'cancelled') =>
    db.$transaction((tx) => transitionReceipt(tx, org, userId, doc.id, v, target, 'test'))
  const stock = async () =>
    (
      await db.inventoryPart.findMany({
        where: { id: { in: parts.map((p) => p.id) } },
        orderBy: { id: 'asc' },
      })
    ).map((p) => p.quantity)
  const movements = () => db.stockMovement.count({ where: { receiptLine: { receiptId: doc.id } } })
  try {
    await assert.rejects(change('wrong-workshop', 1, 'posted'))
    await db.inventoryPart.update({ where: { id: parts[1].id }, data: { isArchived: true } })
    await assert.rejects(change(organizationId, 1, 'posted'))
    assert.deepEqual(await stock(), [3, 3])
    assert.equal(await movements(), 0)
    await db.inventoryPart.update({ where: { id: parts[1].id }, data: { isArchived: false } })
    const attempts = await Promise.allSettled([
      change(organizationId, 1, 'posted'),
      change(organizationId, 1, 'posted'),
    ])
    assert(attempts.some((a) => a.status === 'fulfilled'))
    await change(organizationId, 1, 'posted')
    assert.deepEqual(await stock(), [3.5, 3.5])
    assert.equal(await movements(), 2)
    const used = [{ inventoryPartId: parts[1].id, quantity: 3.25 }]
    await db.$transaction((tx) =>
      reconcileInventoryForParts(tx, organizationId, [], used, { reason: 'service_record', userId })
    )
    await assert.rejects(change(organizationId, 2, 'cancelled'))
    assert.deepEqual(await stock(), [3.5, 0.25])
    assert.equal(await movements(), 2)
    await db.$transaction((tx) =>
      reconcileInventoryForParts(tx, organizationId, used, [], {
        reason: 'service_record_deleted',
        userId,
      })
    )
    await change(organizationId, 2, 'cancelled')
    await change(organizationId, 2, 'cancelled')
    assert.deepEqual(await stock(), [3, 3])
    assert.equal(await movements(), 4)
    console.log(
      'PASS: tenant isolation, fractional receipt, service line, retry, concurrent posting, rollback, work-order consumption and reversal.'
    )
  } finally {
    await db.$transaction(async (tx) => {
      await tx.stockMovement.deleteMany({
        where: { organizationId, inventoryPartId: { in: parts.map((p) => p.id) } },
      })
      await tx.supplierReceipt.delete({ where: { id: doc.id } })
      await tx.inventoryPart.deleteMany({
        where: { organizationId, id: { in: parts.map((p) => p.id) } },
      })
      await tx.counterparty.delete({ where: { id: supplier.id } })
    })
  }
}
check()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
