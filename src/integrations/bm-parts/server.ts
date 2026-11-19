import { z } from 'zod'
import { db } from '@/lib/db'
import type { ConnectorServer } from '@/features/integrations/Lib/types'
import {
  importReceiptDraft,
  RECEIPT_IMPORT_JOB,
  supplierOptions,
} from '@/features/receipts/import-service'
import { receiptsEnabled } from '@/features/receipts/enabled'
import { manifest } from './manifest'
import { BmPartsClient } from './client'
import { importPeriod } from '@/features/receipts/import-types'
import { receiptReference, parseReceipt } from './parser'

const payloadSchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  userId: z.string().min(1),
  runId: z.string().uuid(),
})

export const connector: ConnectorServer = {
  manifest,
  async test(ctx) {
    try {
      await new BmPartsClient(ctx.credentials, ctx.http.fetch).sales(importPeriod(), 1)
      return { ok: true }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'Бус Маркет: помилка входу.' }
    }
  },
  remoteOptions: { suppliers: (ctx) => supplierOptions(ctx.connection.organizationId) },
  jobs: {
    [RECEIPT_IMPORT_JOB]: async (ctx, raw) => {
      const payload = payloadSchema.parse(raw)
      const { organizationId, id: connectionId } = ctx.connection
      if (!receiptsEnabled(organizationId)) throw new Error('Надходження вимкнено.')
      const supplierId = z.string().min(1).parse(ctx.connection.settings.supplierId)
      if (
        !(await db.counterparty.count({
          where: {
            id: supplierId,
            organizationId,
            isArchived: false,
            supplierProfile: { isNot: null },
          },
        }))
      )
        throw new Error('Оберіть активного постачальника в налаштуваннях Бус Маркет.')
      // Count committed documents, including a crash between committing a
      // receipt and saving progress. Retries must not count those as duplicates.
      const imported = await db.integrationLink.findMany({
        where: {
          connectionId,
          entityType: 'SupplierReceipt',
          metadata: { path: ['importRunId'], equals: payload.runId },
        },
        select: { entityId: true },
      })
      const createdIds = new Set(imported.map((link) => link.entityId))
      let created = createdIds.size
      let skipped = 0
      let processed = 0
      const progress = () =>
        ctx.saveState({
          receiptImport: {
            runId: payload.runId,
            from: payload.from,
            to: payload.to,
            created,
            skipped,
            processed,
          },
        })
      await progress()
      const client = new BmPartsClient(ctx.credentials, ctx.http.fetch)
      const seen = new Set<string>()
      const failures: string[] = []
      const deadline = Date.now() + 7 * 60_000
      let exhausted = false
      for (let page = 1; page <= 100; page++) {
        if (Date.now() > deadline) throw new Error('Бус Маркет: час імпорту вичерпано.')
        const documents = await client.sales(payload, page)
        if (!documents.length) {
          exhausted = true
          break
        }
        let newItems = 0
        for (const raw of documents) {
          const item = receiptReference(raw, payload)
          if (seen.has(item.externalId)) continue
          seen.add(item.externalId)
          newItems++
          if (Date.now() > deadline) throw new Error('Бус Маркет: час імпорту вичерпано.')
          try {
            const existing = await db.supplierReceipt.findUnique({
              where: { organizationId_number: { organizationId, number: item.number } },
              select: { id: true, supplierId: true },
            })
            if (existing) {
              if (existing.supplierId !== supplierId)
                throw new Error(`Номер ${item.number} вже використано іншим постачальником.`)
              if (!createdIds.has(existing.id)) skipped++
            } else {
              const receipt = parseReceipt(raw, item)
              const result = await db.$transaction(
                (tx) =>
                  importReceiptDraft(tx, {
                    source: 'bm-parts',
                    organizationId,
                    supplierId,
                    userId: payload.userId,
                    connectionId,
                    runId: payload.runId,
                    receivedDate: payload.to,
                    receipt,
                  }),
                { timeout: 30_000 }
              )
              if (result.created) {
                createdIds.add(result.id)
                created = createdIds.size
              } else skipped++
            }
          } catch (error) {
            failures.push(item.number)
            await ctx.log('warn', `Не вдалося імпортувати накладну ${item.number}.`, {
              reason: error instanceof Error ? error.message.slice(0, 300) : 'Import failed',
            })
          }
          processed++
          await progress()
        }
        if (!newItems) throw new Error('Бус Маркет: API повторює сторінки. Імпорт зупинено.')
      }
      if (!exhausted) throw new Error('Бус Маркет: перевищено ліміт сторінок. Чернетки збережено.')
      if (failures.length)
        throw new Error(
          `Бус Маркет: не імпортовано ${failures.length} накладних (${failures.slice(0, 5).join(', ')}). Подробиці в журналі інтеграції; решту чернеток збережено.`
        )
      return {
        summary: `Створено чернеток: ${created}; вже існують: ${skipped}. Період ${payload.from} — ${payload.to}.`,
      }
    },
  },
}
