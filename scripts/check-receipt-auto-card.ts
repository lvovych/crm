import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { saveReceiptDraft } from '../src/features/receipts/save-ledger'
import { transitionReceipt } from '../src/features/receipts/ledger'
const url = new URL(process.env.DATABASE_URL || '')
assert(['localhost', '127.0.0.1'].includes(url.hostname) && (url.pathname.endsWith('_test') || url.pathname === '/torqvoice_e2e'))
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) }).$extends({ query: {} })
async function main() {
 const { organizationId, userId } = await db.organizationMember.findFirstOrThrow({ where: { role: 'owner' } })
 const run = 'AUTO-' + randomUUID()
 const brands = await Promise.all([0, 1].map(i => db.brand.create({ data: { name: run + i } })))
 const supplier = await db.counterparty.create({ data: { organizationId, createdById: userId, name: run, supplierProfile: { create: {} } } })
 const line = (article = run, brandId = brands[0].id) => ({ kind: 'part', article, brandId, name: 'Test filter', partId: null as string | null, quantity: '2.001', unitPrice: '12.3456', unit: 'шт' })
 const draft = (lines = [line()]) => ({ id: randomUUID(), version: 0, supplierId: supplier.id, number: randomUUID(), documentDate: '2026-11-09', receivedDate: '2026-11-09', lines })
 const save = (d: unknown, post = false, allowed = true, org = organizationId) => db.$transaction(tx => saveReceiptDraft(tx, org, userId, d, post, allowed), { timeout: 15000 })
 const count = () => db.inventoryPart.count({ where: { organizationId, partNumber: { startsWith: run } } })
 try {
  const first = draft([line(), line()]); await save(first)
  assert.equal(await count(), 1)
  let part = await db.inventoryPart.findFirstOrThrow({ where: { organizationId, partNumber: run } })
  assert.equal(part.quantity, 0); assert.equal(part.unitCost, 12.3456); assert.equal(part.brandId, brands[0].id)
  const lines = await db.supplierReceiptLine.findMany({ where: { receiptId: first.id } })
  assert(lines.every(l => l.partId === part.id)); assert.equal(lines[0].amount.toFixed(2), '24.70')
  await save(first); assert.equal(await count(), 1)
  const concurrent = await Promise.all([save(draft([line(run + '-parallel')]), true), save(draft([line(run + '-parallel')]), true)])
  assert.equal(concurrent.length, 2); assert.equal(await count(), 2)
  const parallel = await db.inventoryPart.findFirstOrThrow({ where: { organizationId, partNumber: run + '-parallel' } })
  assert.equal(parallel.quantity, 4.002)
  await save(draft([line(run, brands[1].id)])); assert.equal(await count(), 3)
  const ambiguous = { ...line() }; delete (ambiguous as { brandId?: string }).brandId
  await assert.rejects(save(draft([ambiguous])), /кілька карток/)
  const rollback = draft([line(run + '-rollback'), line(run + '-bad', 'nonexistent-brand')])
  await assert.rejects(save(rollback), /активний бренд/)
  assert.equal(await count(), 3); assert.equal(await db.supplierReceipt.count({ where: { id: rollback.id } }), 0)
  await assert.rejects(save(draft([line(run + '-denied')]), false, false), /дозвіл/)
  assert.equal(await count(), 3)
  await save(draft(), false, false) // Existing card does not require create-inventory permission.
  await assert.rejects(save(draft(), false, true, 'foreign-org'))
  const mismatch = draft([{ ...line(), partId: 'foreign-part' }])
  await assert.rejects(save(mismatch), /Зіставлення/)
  await db.$transaction(tx => transitionReceipt(tx, organizationId, userId, first.id, 1, 'posted', ''))
  part = await db.inventoryPart.findUniqueOrThrow({ where: { id: part.id } }); assert.equal(part.quantity, 4.002)
  await db.$transaction(tx => transitionReceipt(tx, organizationId, userId, first.id, 2, 'cancelled', 'QA'))
  assert.equal((await db.inventoryPart.findUniqueOrThrow({ where: { id: part.id } })).quantity, 0)
  console.log('PASS: automatic branded card, zero-stock draft, repeated lines/retry, concurrent receipts, brand ambiguity, atomic rollback, permissions/tenant, rounding, posting and reversal.')
 } finally {
  const parts = await db.inventoryPart.findMany({ where: { organizationId, partNumber: { startsWith: run } }, select: { id: true } })
  await db.supplierEntry.deleteMany({ where: { supplierId: supplier.id } })
  await db.stockMovement.deleteMany({ where: { inventoryPartId: { in: parts.map(p => p.id) } } })
  await db.supplierReceipt.deleteMany({ where: { supplierId: supplier.id } })
  await db.inventoryPart.deleteMany({ where: { id: { in: parts.map(p => p.id) } } })
  await db.counterparty.delete({ where: { id: supplier.id } })
  await db.brand.deleteMany({ where: { id: { in: brands.map(b => b.id) } } })
  await db.$disconnect()
 }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
