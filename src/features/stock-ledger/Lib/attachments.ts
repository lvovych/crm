import { discardLedgerUpload } from '@/lib/files/manager'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { uploadsRoot } from '@/lib/upload-root'
import { ledgerCommand, metadata, type LedgerDB, type LedgerContext, type Tx } from './transaction'
export const attachmentTarget = z.object({
  kind: z.enum(['receipt', 'subcontract', 'payment']),
  id: z.string().min(1).max(200),
})
export type AttachmentTarget = z.infer<typeof attachmentTarget>
export const attachmentField = (target: AttachmentTarget) =>
  target.kind === 'receipt'
    ? { inventoryDocumentId: target.id }
    : target.kind === 'subcontract'
      ? { supplierServiceDocumentId: target.id }
      : { moneyTransactionId: target.id }
export async function assertAttachmentTarget(tx: Tx, ctx: LedgerContext, target: AttachmentTarget) {
  const where = { organizationId: ctx.organizationId, id: target.id }
  const doc =
    target.kind === 'receipt'
      ? await tx.inventoryDocument.findFirst({ where, select: { id: true } })
      : target.kind === 'subcontract'
        ? await tx.supplierServiceDocument.findFirst({ where, select: { id: true } })
        : await tx.moneyTransaction.findFirst({ where, select: { id: true } })
  if (!doc) throw new Error('Документ недоступний')
}
function location(key: string) {
  if (!/^[a-f0-9-]{36}$/.test(key)) throw new Error('Некоректний файл')
  return path.join(
    process.env.LEDGER_ATTACHMENT_STORAGE ?? path.join(uploadsRoot(), 'ledger-documents'),
    key
  )
}
const mimeByExtension: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.csv': 'text/csv',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}
export async function saveAttachment(
  db: LedgerDB,
  ctx: LedgerContext,
  raw: AttachmentTarget,
  input: { name: string; bytes: Buffer; idempotencyKey: string }
) {
  const target = attachmentTarget.parse(raw),
    name = path
      .basename(input.name.replaceAll('\\', '/'))
      .split('')
      .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)
      .join('')
      .slice(0, 200),
    mimeType = mimeByExtension[path.extname(name).toLowerCase()]
  if (!mimeType) throw new Error('Підтримуються PDF, JPG, PNG, WebP, CSV та XLSX')
  if (!input.bytes.length || input.bytes.length > 10485760)
    throw new Error('Файл має бути від 1 байта до 10 МБ')
  const idempotencyKey = z.string().uuid().parse(input.idempotencyKey),
    sha256 = createHash('sha256').update(input.bytes).digest('hex'),
    storageKey = randomUUID()
  await mkdir(path.dirname(location(storageKey)), { recursive: true, mode: 0o700 })
  await writeFile(location(storageKey), input.bytes, { flag: 'wx', mode: 0o600 })
  const commandInput = { idempotencyKey, target, name, sha256 }
  try {
    const result = await ledgerCommand(db, ctx, 'attachment.add', commandInput, async (tx) => {
      await assertAttachmentTarget(tx, ctx, target)
      const file = await tx.ledgerAttachment.create({
        data: {
          ...metadata(ctx),
          ...attachmentField(target),
          name,
          mimeType,
          size: input.bytes.length,
          sha256,
          storageKey,
        },
      })
      return { id: file.id, name: file.name, storageKey: file.storageKey }
    })
    if (result.storageKey !== storageKey) await discardLedgerUpload('attachment', storageKey, () => db.$transaction((tx) => tx.ledgerAttachment.findUnique({ where: { storageKey } })))
    return { id: result.id, name: result.name }
  } catch (e) {
    await discardLedgerUpload('attachment', storageKey, () => db.$transaction((tx) => tx.ledgerAttachment.findUnique({ where: { storageKey } }))).catch(() => undefined)
    throw e
  }
}
export async function listAttachments(db: LedgerDB, ctx: LedgerContext, raw: AttachmentTarget) {
  const target = attachmentTarget.parse(raw)
  return db.$transaction(async (tx) => {
    await assertAttachmentTarget(tx, ctx, target)
    return tx.ledgerAttachment.findMany({
      where: { organizationId: ctx.organizationId, ...attachmentField(target) },
      select: { id: true, name: true, size: true, createdAt: true, sha256: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
  })
}
export async function readAttachment(
  db: LedgerDB,
  ctx: LedgerContext,
  raw: AttachmentTarget,
  id: string
) {
  const target = attachmentTarget.parse(raw)
  const file = await db.$transaction(async (tx) => {
    await assertAttachmentTarget(tx, ctx, target)
    return tx.ledgerAttachment.findFirstOrThrow({
      where: { id, organizationId: ctx.organizationId, ...attachmentField(target) },
    })
  })
  const bytes = await readFile(location(file.storageKey))
  if (
    bytes.length !== file.size ||
    createHash('sha256').update(bytes).digest('hex') !== file.sha256
  )
    throw new Error('Контрольна сума вкладення не збігається')
  return { bytes, name: file.name, mimeType: file.mimeType }
}
