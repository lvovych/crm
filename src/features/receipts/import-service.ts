import { randomUUID } from 'node:crypto'
import { db, type TxClient } from '@/lib/db'
import type { ImportedReceipt } from './import-types'
import { articleKey } from './articles'

export const RECEIPT_IMPORT_JOB = 'supplier.receipts.import'

/** A database lock coalesces simultaneous clicks, including while the worker is running. */
export async function queueReceiptImport(
  connectionId: string,
  organizationId: string,
  userId: string,
  period: { from: string; to: string }
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${connectionId}, 8814))::text`
    const existing = await tx.integrationJob.findFirst({
      where: {
        connectionId,
        organizationId,
        kind: RECEIPT_IMPORT_JOB,
        status: { in: ['queued', 'running'] },
      },
      select: { id: true },
    })
    if (existing) return existing.id
    const job = await tx.integrationJob.create({
      data: {
        connectionId,
        organizationId,
        kind: RECEIPT_IMPORT_JOB,
        payload: { ...period, userId, runId: randomUUID() },
        maxAttempts: 3,
      },
    })
    return job.id
  })
}

/** No stock, catalogue or settlement mutations: unmatched parts stay in a draft. */
export async function importReceiptDraft(
  tx: TxClient,
  input: {
    organizationId: string
    supplierId: string
    userId: string
    connectionId: string
    runId: string
    receivedDate: string
    source?: 'ukrcar' | 'bm-parts'
    receipt: ImportedReceipt
  }
) {
  const { organizationId, supplierId, userId, connectionId, receivedDate, receipt } = input
  // Shared with manual draft creation, so both paths see the same number reservation.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId}, 8812))::text`
  const existing = await tx.supplierReceipt.findUnique({
    where: { organizationId_number: { organizationId, number: receipt.number } },
  })
  if (existing) {
    if (existing.supplierId !== supplierId)
      throw new Error(`Номер ${receipt.number} вже використано іншим постачальником.`)
    return { id: existing.id, created: false }
  }
  const supplier = await tx.counterparty.findFirst({
    where: { id: supplierId, organizationId, isArchived: false, supplierProfile: { isNot: null } },
  })
  if (!supplier) throw new Error('Оберіть активного постачальника в налаштуваннях інтеграції.')
  const parts = await tx.inventoryPart.findMany({
    where: { organizationId, isArchived: false },
    select: { id: true, partNumber: true, unit: true, brand: { select: { name: true } } },
  })
  const result = await tx.supplierReceipt.create({
    data: {
      organizationId,
      supplierId,
      createdById: userId,
      number: receipt.number,
      documentDate: new Date(`${receipt.date}T00:00:00Z`),
      receivedDate: new Date(`${receivedDate}T00:00:00Z`),
      status: 'draft',
      currency: 'UAH',
      source: input.source ?? 'ukrcar',
      sourceAccount: connectionId,
      externalId: receipt.externalId,
      lines: {
        create: receipt.lines.map((line, position) => {
          const matches = parts.filter(
            (p) =>
              p.partNumber &&
              articleKey(p.partNumber) === articleKey(line.article) &&
              articleKey(p.brand.name) === articleKey(line.brand) &&
              (p.unit || 'шт') === 'шт'
          )
          return {
            position,
            kind: 'part',
            name: line.name,
            article: line.article,
            brandSnapshot: line.brand,
            unit: 'шт',
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            amount: line.amount,
            partId: matches.length === 1 ? matches[0].id : null,
          }
        }),
      },
    },
  })
  await tx.integrationLink.create({
    data: {
      connectionId,
      entityType: 'SupplierReceipt',
      entityId: result.id,
      remoteId: receipt.externalId,
      remoteUrl: receipt.url,
      metadata: { number: receipt.number, importRunId: input.runId },
    },
  })
  return { id: result.id, created: true }
}

export async function supplierOptions(organizationId: string) {
  const rows = await db.counterparty.findMany({
    where: { organizationId, isArchived: false, supplierProfile: { isNot: null } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
  return rows.map((r) => ({ value: r.id, label: r.name }))
}
