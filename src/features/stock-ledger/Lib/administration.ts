import { z } from 'zod'
import { commandSchema, dateText } from './contracts'
import { ledgerCommand, metadata, type LedgerDB, type LedgerContext } from './transaction'
import { reconciliation } from './reconciliation'
export function closeLedgerPeriod(db: LedgerDB, ctx: LedgerContext, raw: unknown) {
  const input = commandSchema
    .extend({
      through: dateText,
      area: z.enum(['INVENTORY', 'FINANCE', 'BOTH']),
      reason: z.string().trim().min(5).max(2000),
      confirmed: z.literal(true),
    })
    .parse(raw)
  return ledgerCommand(db, ctx, 'period.close', input, async (tx) => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date())
    if (input.through.toISOString().slice(0, 10) >= today)
      throw new Error('Закрити можна лише минулий день або попередній період')
    if ((await reconciliation(tx, ctx)).length)
      throw new Error('Спочатку усуньте розбіжності складського журналу')
    if (
      await tx.inventoryDocument.count({
        where: {
          organizationId: ctx.organizationId,
          status: 'DRAFT',
          effectiveAt: { lte: input.through },
        },
      })
    )
      throw new Error('У періоді є непроведені складські документи')
    const current = await tx.accountingPeriodLock.findUnique({
      where: { organizationId: ctx.organizationId },
    })
    const inventory = input.area !== 'FINANCE',
      finance = input.area !== 'INVENTORY'
    if (
      (inventory &&
        current?.inventoryClosedThrough &&
        input.through < current.inventoryClosedThrough) ||
      (finance && current?.financeClosedThrough && input.through < current.financeClosedThrough)
    )
      throw new Error('Повторне відкриття закритого періоду заборонене')
    const dates = {
      ...(inventory ? { inventoryClosedThrough: input.through } : {}),
      ...(finance ? { financeClosedThrough: input.through } : {}),
    }
    const row = await tx.accountingPeriodLock.upsert({
      where: { organizationId: ctx.organizationId },
      create: { ...metadata(ctx), ...dates, reason: input.reason },
      update: { ...dates, reason: input.reason },
    })
    return {
      id: row.id,
      inventoryClosedThrough: row.inventoryClosedThrough?.toISOString().slice(0, 10) ?? null,
      financeClosedThrough: row.financeClosedThrough?.toISOString().slice(0, 10) ?? null,
    }
  })
}
