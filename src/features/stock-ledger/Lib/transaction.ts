import { createHash } from 'node:crypto'
import { Prisma, type PrismaClient } from '@/generated/prisma/client'
export type LedgerContext = { organizationId: string; userId: string }
export type Tx = Prisma.TransactionClient
export type LedgerDB = Pick<PrismaClient, '$transaction'>
function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    )
  return JSON.stringify(value) ?? 'null'
}
export function metadata(ctx: LedgerContext) {
  return { organizationId: ctx.organizationId, createdById: ctx.userId }
}
export async function ledgerCommand<T extends Prisma.InputJsonObject>(
  db: LedgerDB,
  ctx: LedgerContext,
  scope: string,
  input: { idempotencyKey: string },
  run: (tx: Tx) => Promise<T>
): Promise<T> {
  const requestHash = createHash('sha256').update(canonical(input)).digest('hex')
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(
        async (tx) => {
          // One transaction lock per organization: deterministic ordering for all ledger writers,
          // including first balances and idempotency keys. No locks escape the transaction.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ctx.organizationId}, 613))`
          const key = { organizationId: ctx.organizationId, scope, key: input.idempotencyKey }
          const previous = await tx.ledgerCommand.findUnique({
            where: { organizationId_scope_key: key },
          })
          if (previous) {
            if (previous.requestHash !== requestHash)
              throw new Error('Цей ключ запиту вже використано з іншими даними')
            return previous.response as T
          }
          const result = await run(tx)
          await tx.ledgerCommand.create({
            data: { ...metadata(ctx), ...key, requestHash, response: result },
          })
          await tx.ledgerAuditEvent.create({
            data: {
              ...metadata(ctx),
              entityType: scope,
              entityId: String(result.id ?? ctx.organizationId),
              action: scope,
              requestId: input.idempotencyKey,
              payload: { request: JSON.parse(JSON.stringify(input)), result },
            },
          })
          return result
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          maxWait: 10000,
          timeout: scope === 'migration.apply' ? 120000 : 20000,
        }
      )
    } catch (error) {
      if (
        attempt < 3 &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      )
        continue
      throw error
    }
  }
}
export async function assertPeriod(tx: Tx, ctx: LedgerContext, date: Date, inventory: boolean) {
  const lock = await tx.accountingPeriodLock.findUnique({
    where: { organizationId: ctx.organizationId },
  })
  if (
    (lock?.financeClosedThrough && date <= lock.financeClosedThrough) ||
    (inventory && lock?.inventoryClosedThrough && date <= lock.inventoryClosedThrough)
  )
    throw new Error('Період закритий для проведення документів')
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date())
  if (date.toISOString().slice(0, 10) > today)
    throw new Error('Проведення майбутньою датою заборонено')
}
