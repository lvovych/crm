import { createHash } from 'node:crypto'
import type { LedgerDB, LedgerContext } from './transaction'
import { fullReconciliation } from './reconciliation'
export const DIAGNOSTIC_KEY = 'stockLedger.lastDiagnostic.v1'
export async function runLedgerDiagnostic(db: LedgerDB, ctx: LedgerContext, now = new Date()) {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ctx.organizationId},614))`
      const key = { organizationId: ctx.organizationId, key: DIAGNOSTIC_KEY },
        previous = await tx.appSetting.findUnique({ where: { organizationId_key: key } }),
        day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(now)
      const last = previous
        ? (JSON.parse(previous.value) as {
            day: string
            hash: string
            count: number
            checkedAt: string
          })
        : null
      if (last?.day === day)
        return { checkedAt: last.checkedAt, count: last.count, notified: false }
      const issues = await fullReconciliation(tx, ctx),
        hash = createHash('sha256')
          .update(
            JSON.stringify([...issues].sort((a, b) => (a.kind + a.id).localeCompare(b.kind + b.id)))
          )
          .digest('hex'),
        notified = issues.length > 0 && hash !== last?.hash
      if (notified)
        await tx.notification.create({
          data: {
            organizationId: ctx.organizationId,
            type: 'ledger_reconciliation',
            title: 'Потрібна перевірка складського обліку',
            message:
              'Автоматична звірка виявила розбіжності. Адміністратор може відкрити діагностику; дані не виправлялися автоматично.',
            entityType: 'StockLedger',
            entityId: ctx.organizationId,
            entityUrl: '/stock-ledger?view=administration',
          },
        })
      const value = JSON.stringify({
        day,
        checkedAt: now.toISOString(),
        hash,
        count: issues.length,
      })
      await tx.appSetting.upsert({
        where: { organizationId_key: key },
        create: { ...key, userId: ctx.userId, value },
        update: { value },
      })
      return { checkedAt: now.toISOString(), count: issues.length, notified }
    },
    { isolationLevel: 'RepeatableRead', timeout: 60000, maxWait: 10000 }
  )
}
