import { randomUUID as key } from 'node:crypto'
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { createStockLedger } from '@/features/stock-ledger/Lib/service'
import { subcontractOperations } from '@/features/stock-ledger/Lib/subcontracts'
import {
  saveAttachment,
  listAttachments,
  readAttachment,
} from '@/features/stock-ledger/Lib/attachments'
const url = process.env.LEDGER_TEST_DATABASE_URL
if (
  url &&
  !/^postgresql:\/\/[^@]+@(?:127\.0\.0\.1|localhost):\d+\/crm_ledger_test(?:\?|$)/.test(url)
)
  throw new Error('Isolated DB only')
;(url ? describe : describe.skip)('document attachments', () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }),
    ctx = { organizationId: key(), userId: key() },
    ledger = createStockLedger(db, ctx)
  let storage: string, receipt: string, payment: string, subcontract: string
  beforeAll(async () => {
    storage = await mkdtemp(path.join(os.tmpdir(), 'ledger-attachments-test-'))
    process.env.LEDGER_ATTACHMENT_STORAGE = storage
    await db.user.create({
      data: { id: ctx.userId, name: 'Attachments', email: ctx.userId + '@example.test' },
    })
    await db.organization.create({ data: { id: ctx.organizationId, name: 'Attachments' } })
    const supplier = await ledger.createSupplier({
        idempotencyKey: key(),
        name: 'Supplier',
        kind: 'BOTH',
      }),
      warehouse = await ledger.createWarehouse({
        idempotencyKey: key(),
        code: 'A',
        name: 'Warehouse',
      }),
      account = await ledger.createAccount({ idempotencyKey: key(), name: 'Bank' }),
      product = await db.inventoryPart.create({
        data: { organizationId: ctx.organizationId, userId: ctx.userId, name: 'Product' },
      })
    receipt = (
      await ledger.saveReceiptDraft({
        idempotencyKey: key(),
        supplierId: supplier.id,
        warehouseId: warehouse.id,
        effectiveAt: '2026-10-20',
        externalDate: '2026-10-20',
        dueDate: '2026-10-20',
        externalNumber: key(),
        lines: [{ inventoryPartId: product.id, quantity: '1', unitPrice: '10' }],
      })
    ).id
    payment = (
      await ledger.postMoneyTransaction({
        idempotencyKey: key(),
        partyId: supplier.partyId,
        accountId: account.id,
        direction: 'OUT',
        amount: '10',
        effectiveAt: '2026-10-20',
        method: 'bank',
      })
    ).id
    const job = await db.serviceRecord.create({
      data: { organizationId: ctx.organizationId, title: 'Job' },
    })
    subcontract = (
      await subcontractOperations(db, ctx).save({
        idempotencyKey: key(),
        supplierId: supplier.id,
        effectiveAt: '2026-10-20',
        dueDate: '2026-10-20',
        externalNumber: key(),
        lines: [{ serviceRecordId: job.id, description: 'Repair', quantity: '1', unitCost: '10' }],
      })
    ).id
  })
  afterAll(async () => {
    delete process.env.LEDGER_ATTACHMENT_STORAGE
    await rm(storage, { recursive: true, force: true })
    await db.$disconnect()
  })
  it('supports each document, retries without duplicate files and checks bytes', async () => {
    for (const [kind, id] of [
      ['receipt', receipt],
      ['payment', payment],
      ['subcontract', subcontract],
    ] as const) {
      const target = { kind, id },
        input = { idempotencyKey: key(), name: '../scan.pdf', bytes: Buffer.from('%PDF-test') },
        saved = await saveAttachment(db, ctx, target, input)
      expect(await saveAttachment(db, ctx, target, input)).toEqual(saved)
      const rows = await listAttachments(db, ctx, target)
      expect(rows).toHaveLength(1)
      expect(rows[0].name).toBe('scan.pdf')
      expect((await readAttachment(db, ctx, target, saved.id)).bytes.equals(input.bytes)).toBe(true)
      await expect(
        saveAttachment(db, ctx, target, { ...input, bytes: Buffer.from('changed') })
      ).rejects.toThrow('ключ')
    }
    expect(await readdir(storage)).toHaveLength(3)
  })
  it('foreign document/file, invalid format/size and tampering cannot leak or replace files', async () => {
    const target = { kind: 'receipt' as const, id: receipt },
      input = { idempotencyKey: key(), name: 'scan.pdf', bytes: Buffer.from('%PDF-good') }
    await expect(
      saveAttachment(db, { ...ctx, organizationId: key() }, target, input)
    ).rejects.toThrow('недоступний')
    await expect(saveAttachment(db, ctx, target, { ...input, name: 'x.html' })).rejects.toThrow(
      'Підтримуються'
    )
    await expect(
      saveAttachment(db, ctx, target, { ...input, bytes: Buffer.alloc(0) })
    ).rejects.toThrow('10 МБ')
    await expect(
      saveAttachment(db, ctx, target, { ...input, bytes: Buffer.alloc(10485761) })
    ).rejects.toThrow('10 МБ')
    const saved = await saveAttachment(db, ctx, target, input)
    await expect(
      readAttachment(db, ctx, { kind: 'payment', id: payment }, saved.id)
    ).rejects.toThrow()
    await expect(listAttachments(db, { ...ctx, organizationId: key() }, target)).rejects.toThrow()
    const row = await db.ledgerAttachment.findUniqueOrThrow({ where: { id: saved.id } })
    await expect(
      db.ledgerAttachment.update({ where: { id: saved.id }, data: { name: 'replacement.pdf' } })
    ).rejects.toThrow()
    await writeFile(path.join(storage, row.storageKey), 'tampered')
    await expect(readAttachment(db, ctx, target, saved.id)).rejects.toThrow('Контрольна сума')
    expect(await readdir(storage)).toHaveLength(4)
  })
})
