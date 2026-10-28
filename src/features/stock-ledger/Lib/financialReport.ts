import { z } from 'zod'
import { D } from './amounts'
import type { Tx, LedgerContext } from './transaction'
/** As-of uses business dates, including reversals' effective dates, never today's status. */
export async function financialReport(tx: Tx, ctx: LedgerContext, raw: unknown) {
  const { through } = z.object({ through: z.iso.date() }).parse(raw),
    date = new Date(through + 'T23:59:59.999Z'),
    org = { organizationId: ctx.organizationId }
  const entries = await tx.settlementEntry.findMany({
    where: { ...org, effectiveAt: { lte: date } },
    include: { party: true },
  })
  const allocations = await tx.settlementAllocation.findMany({
    where: {
      ...org,
      effectiveAt: { lte: date },
      OR: [{ reversedAt: null }, { reversedAt: { gt: date } }],
    },
  })
  const allocated = new Map<string, ReturnType<typeof D>>()
  for (const a of allocations)
    for (const id of [a.debitEntryId, a.creditEntryId])
      allocated.set(id, (allocated.get(id) ?? D(0)).plus(a.amount))
  const groups = new Map<
    string,
    {
      id: string
      name: string
      side: string
      debt: ReturnType<typeof D>
      advance: ReturnType<typeof D>
      balance: ReturnType<typeof D>
      overdue: ReturnType<typeof D>
      notDue: ReturnType<typeof D>
      nearestDue: string | null
    }
  >()
  const errors: string[] = []
  for (const e of entries) {
    const id = e.partyId + ':' + e.side,
      row = groups.get(id) ?? {
        id: e.partyId,
        name: e.party.displayNameSnapshot,
        side: e.side,
        debt: D(0),
        advance: D(0),
        balance: D(0),
        overdue: D(0),
        notDue: D(0),
        nearestDue: null as string | null,
      }
    const remaining = D(e.amount).minus(allocated.get(e.id) ?? 0)
    if (remaining.lt(0)) errors.push('Надмірне рознесення: ' + e.id)
    if (e.polarity === 'DEBIT') {
      row.debt = row.debt.plus(remaining)
      const due = e.dueDate?.toISOString().slice(0, 10)
      if (due && due < through) row.overdue = row.overdue.plus(remaining)
      else row.notDue = row.notDue.plus(remaining)
      if (due && remaining.gt(0) && (!row.nearestDue || due < row.nearestDue)) row.nearestDue = due
    } else row.advance = row.advance.plus(remaining)
    row.balance = row.balance.plus(D(e.amount).mul(e.polarity === 'DEBIT' ? 1 : -1))
    groups.set(id, row)
  }
  const cash = await tx.cashLedgerEntry.groupBy({
    by: ['accountId'],
    where: { ...org, effectiveAt: { lte: date } },
    _sum: { amountDelta: true },
  })
  const accounts = await tx.cashAccount.findMany({ where: org, select: { id: true, name: true } }),
    accountNames = new Map(accounts.map((a) => [a.id, a.name]))
  const stock = await tx.inventoryLedgerEntry.groupBy({
    by: ['lotId', 'warehouseId'],
    where: { ...org, effectiveAt: { lte: date } },
    _sum: { quantityDelta: true, costAmountDelta: true },
  })
  const warehouseValues = new Map<string, ReturnType<typeof D>>()
  for (const s of stock) {
    const qty = D(s._sum.quantityDelta ?? 0),
      cost = D(s._sum.costAmountDelta ?? 0)
    if (qty.lt(0) || cost.lt(0) || (qty.isZero() && !cost.isZero()))
      errors.push('Розбіжність кількості/вартості партії: ' + s.lotId + ' / ' + s.warehouseId)
    warehouseValues.set(s.warehouseId, (warehouseValues.get(s.warehouseId) ?? D(0)).plus(cost))
  }
  const warehouses = await tx.warehouse.findMany({ where: org, select: { id: true, name: true } }),
    names = new Map(warehouses.map((w) => [w.id, w.name]))
  const parties = [...groups.values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'uk'))
    .map((r) => ({
      ...r,
      debt: r.debt.toFixed(2),
      advance: r.advance.toFixed(2),
      balance: r.balance.toFixed(2),
      overdue: r.overdue.toFixed(2),
      notDue: r.notDue.toFixed(2),
    }))
  return {
    through,
    parties,
    cash: cash.map((c) => ({
      id: c.accountId,
      name: accountNames.get(c.accountId) ?? c.accountId,
      balance: D(c._sum.amountDelta ?? 0).toFixed(2),
    })),
    stock: [...warehouseValues].map(([id, cost]) => ({
      id,
      name: names.get(id) ?? id,
      cost: cost.toFixed(6),
    })),
    errors,
  }
}
