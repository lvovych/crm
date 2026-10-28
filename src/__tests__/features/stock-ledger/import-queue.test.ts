import { randomUUID as key } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import {
  enqueueImport,
  runImportTasks,
  readImportOriginal,
} from '@/features/stock-ledger/Lib/importQueue'
import { createStockLedger } from '@/features/stock-ledger/Lib/service'
const url = process.env.LEDGER_TEST_DATABASE_URL
if (
  url &&
  !/^postgresql:\/\/[^@]+@(?:127\.0\.0\.1|localhost):\d+\/crm_ledger_test(?:\?|$)/.test(url)
)
  throw new Error('Isolated DB only')
;(url ? describe : describe.skip)('durable import queue', () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }),
    ctx = { organizationId: key(), userId: key() },
    mapping = { article: 'a', brand: 'b', quantity: 'q', unitPrice: 'p' },
    bytes = Buffer.from('a;b;q;p\nA;---;1;0.01')
  let supplierId: string, root: string
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'crm-import-test-'))
    process.env.LEDGER_IMPORT_STORAGE = root
    await db.user.create({
      data: { id: ctx.userId, name: 'Queue test', email: ctx.userId + '@example.test' },
    })
    await db.organization.create({ data: { id: ctx.organizationId, name: 'Queue test' } })
    supplierId = (
      await createStockLedger(db, ctx).createSupplier({
        idempotencyKey: key(),
        name: 'Queue supplier',
      })
    ).id
  })
  afterAll(async () => {
    delete process.env.LEDGER_IMPORT_STORAGE
    await db.$disconnect()
    await rm(root, { recursive: true, force: true })
  })
  const enqueue = () =>
    enqueueImport(db, ctx, { supplierId, name: '../source.csv', format: 'csv', bytes, mapping })
  it('stores original privately, processes once under concurrent workers and reuses file preview', async () => {
    const task = await enqueue()
    expect(task.status).toBe('QUEUED')
    await Promise.all([runImportTasks(db, task.id), runImportTasks(db, task.id)])
    const saved = await db.ledgerImportTask.findUniqueOrThrow({ where: { id: task.id } })
    expect(saved.status).toBe('READY')
    expect(saved.attempts).toBe(1)
    expect(saved.previewJobId).toBeTruthy()
    expect((await readImportOriginal(db, ctx, task.id)).bytes.equals(bytes)).toBe(true)
    await expect(
      readImportOriginal(db, { ...ctx, organizationId: key() }, task.id)
    ).rejects.toThrow()
    const second = await enqueue()
    await runImportTasks(db, second.id)
    expect(
      (await db.ledgerImportTask.findUniqueOrThrow({ where: { id: second.id } })).previewJobId
    ).toBe(saved.previewJobId)
    expect(
      await db.inventoryDocument.count({ where: { organizationId: ctx.organizationId } })
    ).toBe(0)
  })
  it('recovers expired worker leases and exposes bounded failure for a changed original', async () => {
    const task = await enqueue()
    await db.ledgerImportTask.update({
      where: { id: task.id },
      data: { status: 'RUNNING', attempts: 1, leaseUntil: new Date(0) },
    })
    await runImportTasks(db, task.id)
    expect((await db.ledgerImportTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe(
      'READY'
    )
    const broken = await enqueue()
    await writeFile(path.join(root, broken.id), 'changed')
    await runImportTasks(db, broken.id)
    expect(
      (await db.ledgerImportTask.findUniqueOrThrow({ where: { id: broken.id } })).error
    ).toContain('Контрольна сума')
    const final = await enqueue()
    await db.ledgerImportTask.update({
      where: { id: final.id },
      data: { status: 'RUNNING', attempts: 3, leaseUntil: new Date(0) },
    })
    await runImportTasks(db, final.id)
    expect((await db.ledgerImportTask.findUniqueOrThrow({ where: { id: final.id } })).status).toBe(
      'FAILED'
    )
  })
  it('rejects oversized, empty and foreign supplier uploads before creating a task', async () => {
    for (const value of [Buffer.alloc(0), Buffer.alloc(10 * 1024 * 1024 + 1)])
      await expect(
        enqueueImport(db, ctx, { supplierId, name: 'x.csv', format: 'csv', bytes: value, mapping })
      ).rejects.toThrow('10 МБ')
    await expect(
      enqueueImport(db, ctx, { supplierId: key(), name: 'x.csv', format: 'csv', bytes, mapping })
    ).rejects.toThrow()
  })
})
