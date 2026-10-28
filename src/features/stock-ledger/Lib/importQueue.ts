import { discardLedgerUpload } from '@/lib/files/manager'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { uploadsRoot } from '@/lib/upload-root'
import type { PrismaClient, Prisma } from '@/generated/prisma/client'
import { ledgerCommand, type LedgerDB, type LedgerContext } from './transaction'
import { previewImport } from './importService'
import { importMappingSchema, type ImportMapping } from './imports'
function location(key: string) {
  if (!/^[a-f0-9-]{36}$/.test(key)) throw new Error('Некоректний файл')
  return path.join(
    process.env.LEDGER_IMPORT_STORAGE ?? path.join(uploadsRoot(), 'ledger-imports'),
    key
  )
}
export async function enqueueImport(
  db: LedgerDB,
  ctx: LedgerContext,
  input: {
    supplierId: string
    name: string
    format: 'csv' | 'xlsx'
    bytes: Buffer
    mapping: ImportMapping
  }
) {
  if (!input.bytes.length || input.bytes.length > 10 * 1024 * 1024)
    throw new Error('Файл має бути від 1 байта до 10 МБ')
  const mapping = importMappingSchema.parse(input.mapping),
    id = randomUUID(),
    fileHash = createHash('sha256').update(input.bytes).digest('hex')
  await mkdir(path.dirname(location(id)), { recursive: true, mode: 0o700 })
  await writeFile(location(id), input.bytes, { flag: 'wx', mode: 0o600 })
  try {
    return await ledgerCommand(db, ctx, 'import.enqueue', { idempotencyKey: id }, async (tx) => {
      await tx.supplier.findFirstOrThrow({
        where: { organizationId: ctx.organizationId, id: input.supplierId, archivedAt: null },
      })
      await tx.ledgerImportTask.create({
        data: {
          id,
          organizationId: ctx.organizationId,
          createdById: ctx.userId,
          supplierId: input.supplierId,
          sourceName: input.name.slice(0, 200),
          format: input.format,
          fileHash,
          storageKey: id,
          size: input.bytes.length,
          mapping: mapping as Prisma.InputJsonObject,
        },
      })
      return { id, status: 'QUEUED' }
    })
  } catch (e) {
    await discardLedgerUpload('import', id, () => db.$transaction((tx) => tx.ledgerImportTask.findFirst({ where: { storageKey: id } }))).catch(() => undefined)
    throw e
  }
}
export async function readImportOriginal(db: PrismaClient, ctx: LedgerContext, id: string) {
  const task = await db.ledgerImportTask.findFirstOrThrow({
    where: { organizationId: ctx.organizationId, id },
  })
  const bytes = await readFile(location(task.storageKey))
  if (createHash('sha256').update(bytes).digest('hex') !== task.fileHash)
    throw new Error('Контрольна сума оригіналу не збігається')
  return { bytes, name: task.sourceName, format: task.format }
}
/** Durable lease: an interrupted worker is retried after five minutes, at most three times. */
export async function runImportTasks(db: PrismaClient, onlyId?: string) {
  const now = new Date(),
    candidates = await db.ledgerImportTask.findMany({
      where: {
        ...(onlyId ? { id: onlyId } : {}),
        attempts: { lt: 3 },
        OR: [{ status: 'QUEUED' }, { status: 'RUNNING', leaseUntil: { lt: now } }],
      },
      orderBy: { createdAt: 'asc' },
      take: 3,
    })
  for (const task of candidates) {
    const claim = await db.ledgerImportTask.updateMany({
      where: {
        id: task.id,
        attempts: task.attempts,
        OR: [{ status: 'QUEUED' }, { status: 'RUNNING', leaseUntil: { lt: now } }],
      },
      data: {
        status: 'RUNNING',
        attempts: { increment: 1 },
        leaseUntil: new Date(now.getTime() + 300000),
        error: null,
      },
    })
    if (!claim.count) continue
    try {
      if (!task.createdById) throw new Error('Користувач, який завантажив файл, більше не існує')
      const ctx = { organizationId: task.organizationId, userId: task.createdById },
        original = await readImportOriginal(db, ctx, task.id)
      const result = await previewImport(db, ctx, {
        supplierId: task.supplierId,
        name: task.sourceName,
        format: task.format as 'csv' | 'xlsx',
        bytes: original.bytes,
        mapping: importMappingSchema.parse(task.mapping),
        taskLease: { id: task.id, attempt: task.attempts + 1 },
      })
      await db.ledgerImportTask.updateMany({
        where: { id: task.id, status: 'RUNNING', attempts: task.attempts + 1 },
        data: { status: 'READY', previewJobId: result.id, leaseUntil: null },
      })
    } catch (e) {
      await db.ledgerImportTask.updateMany({
        where: { id: task.id, status: 'RUNNING', attempts: task.attempts + 1 },
        data: {
          status: 'FAILED',
          leaseUntil: null,
          error: e instanceof Error ? e.message.slice(0, 500) : 'Не вдалося обробити файл',
        },
      })
    }
  }
  // A worker may die on its final attempt: surface that task instead of leaving it running forever.
  await db.ledgerImportTask.updateMany({
    where: { status: 'RUNNING', attempts: { gte: 3 }, leaseUntil: { lt: now } },
    data: { status: 'FAILED', leaseUntil: null, error: 'Обробку перервано. Повторіть запуск.' },
  })
}
