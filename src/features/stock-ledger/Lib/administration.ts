import { z } from 'zod'
import { commandSchema, dateText } from './contracts'
import { ledgerCommand, metadata, type LedgerDB, type LedgerContext } from './transaction'
import { fullReconciliation } from './reconciliation'
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
    if ((await fullReconciliation(tx, ctx)).length)
      throw new Error('Спочатку усуньте розбіжності складського журналу')
    const inventory = input.area !== 'FINANCE',
      finance = input.area !== 'INVENTORY'
    if (
      inventory &&
      (await tx.inventoryDocument.count({
        where: {
          organizationId: ctx.organizationId,
          status: 'DRAFT',
          effectiveAt: { lte: input.through },
        },
      }))
    )
      throw new Error('У періоді є непроведені складські документи')
    if (
      finance &&
      (await tx.moneyTransaction.count({
        where: {
          organizationId: ctx.organizationId,
          status: 'DRAFT',
          effectiveAt: { lte: input.through },
        },
      }))
    )
      throw new Error('У періоді є непроведені оплати')
    if (
      inventory &&
      (await tx.ledgerStockCount.count({
        where: {
          organizationId: ctx.organizationId,
          status: 'COUNTING',
          effectiveAt: { lte: input.through },
        },
      }))
    )
      throw new Error('У періоді є незавершені інвентаризації')
    if (
      finance &&
      (await tx.supplierServiceDocument.count({
        where: {
          organizationId: ctx.organizationId,
          status: 'DRAFT',
          effectiveAt: { lte: input.through },
        },
      }))
    )
      throw new Error('У періоді є непроведені акти підрядників')
    const current = await tx.accountingPeriodLock.findUnique({
      where: { organizationId: ctx.organizationId },
    })
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

export function reopenLedgerPeriod(db: LedgerDB, ctx: LedgerContext, raw: unknown) {
  const input = commandSchema
    .extend({
      from: dateText,
      area: z.enum(['INVENTORY', 'FINANCE', 'BOTH']),
      reason: z.string().trim().min(5).max(2000),
      confirmed: z.literal(true),
    })
    .parse(raw)
  return ledgerCommand(db, ctx, 'period.reopen', input, async (tx) => {
    const current = await tx.accountingPeriodLock.findUnique({
      where: { organizationId: ctx.organizationId },
    })
    if (!current) throw new Error('Немає закритого періоду')
    const previousDay = new Date(input.from.getTime() - 86400000),
      inventory = input.area !== 'FINANCE',
      finance = input.area !== 'INVENTORY'
    if (
      (inventory &&
        (!current.inventoryClosedThrough || input.from > current.inventoryClosedThrough)) ||
      (finance && (!current.financeClosedThrough || input.from > current.financeClosedThrough))
    )
      throw new Error('Вибрана дата вже відкрита')
    const before = {
      inventory: current.inventoryClosedThrough?.toISOString().slice(0, 10) ?? null,
      finance: current.financeClosedThrough?.toISOString().slice(0, 10) ?? null,
    }
    await tx.accountingPeriodLock.update({
      where: { id: current.id },
      data: {
        ...(inventory ? { inventoryClosedThrough: previousDay } : {}),
        ...(finance ? { financeClosedThrough: previousDay } : {}),
        reason: input.reason,
      },
    })
    return {
      id: current.id,
      before,
      openedFrom: input.from.toISOString().slice(0, 10),
      reason: input.reason,
    }
  })
}
