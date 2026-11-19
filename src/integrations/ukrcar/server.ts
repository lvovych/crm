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
import { UkrcarClient } from './client'
import { listUrl, parseList, parseReceipt } from './parser'

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
      await new UkrcarClient(ctx.http.fetch).login(ctx.credentials)
      return { ok: true }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'Укркар: помилка входу.' }
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
        throw new Error('Оберіть активного постачальника в налаштуваннях Укркар.')
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
      const client = new UkrcarClient(ctx.http.fetch)
      await client.login(ctx.credentials)
      let url: string | null = listUrl(payload)
      const visited = new Set<string>()
      const seen = new Set<string>()
      const failures: string[] = []
      const deadline = Date.now() + 7 * 60_000
      while (url) {
        if (visited.has(url) || visited.size >= 100 || Date.now() > deadline)
          throw new Error(
            'Укркар: перевищено ліміт сторінок або часу. Завантажені чернетки збережено.'
          )
        visited.add(url)
        const page = parseList(await client.request(url), url, payload)
        for (const item of page.receipts) {
          if (seen.has(item.number)) continue
          seen.add(item.number)
          if (Date.now() > deadline)
            throw new Error('Укркар: час імпорту вичерпано. Завантажені чернетки збережено.')
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
              const receipt = parseReceipt(await client.request(item.url), item)
              const result = await db.$transaction(
                (tx) =>
                  importReceiptDraft(tx, {
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
        url = page.next
      }
      if (failures.length)
        throw new Error(
          `Укркар: не імпортовано ${failures.length} накладних (${failures.slice(0, 5).join(', ')}). Подробиці в журналі інтеграції; решту чернеток збережено.`
        )
      return {
        summary: `Створено чернеток: ${created}; вже існують: ${skipped}. Період ${payload.from} — ${payload.to}.`,
      }
    },
  },
}
