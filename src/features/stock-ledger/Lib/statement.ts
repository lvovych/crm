import { z } from 'zod'
import { D } from './amounts'
import { csvCell } from './reconciliation'
import type { Tx, LedgerContext } from './transaction'
export async function partyStatement(tx: Tx, ctx: LedgerContext, raw: unknown) {
  const input = z
    .object({ partyId: z.string().min(1), from: z.iso.date(), through: z.iso.date() })
    .refine((i) => i.from <= i.through, 'Початок періоду пізніше завершення')
    .parse(raw)
  const party = await tx.settlementParty.findFirstOrThrow({
    where: { organizationId: ctx.organizationId, id: input.partyId },
  })
  const entries = await tx.settlementEntry.findMany({
    where: {
      organizationId: ctx.organizationId,
      partyId: party.id,
      effectiveAt: { lte: new Date(input.through + 'T23:59:59.999Z') },
    },
    include: {
      customerAdjustment: { select: { number: true } },
      inventoryDocument: { select: { number: true } },
      supplierServiceDocument: { select: { number: true } },
      serviceRecord: { select: { invoiceNumber: true, title: true } },
      moneyTransaction: { select: { method: true } },
      openingBalance: { select: { sourceNote: true } },
    },
    orderBy: [{ effectiveAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  })
  let opening = D(0),
    running = D(0),
    debit = D(0),
    credit = D(0)
  const rows: {
    id: string
    date: string
    document: string
    debit: string
    credit: string
    balance: string
  }[] = []
  for (const e of entries) {
    const signed = e.amount.mul(e.polarity === 'DEBIT' ? 1 : -1),
      day = e.effectiveAt.toISOString().slice(0, 10)
    running = running.plus(signed)
    if (day < input.from) {
      opening = opening.plus(signed)
      continue
    }
    if (e.polarity === 'DEBIT') debit = debit.plus(e.amount)
    else credit = credit.plus(e.amount)
    rows.push({
      id: e.id,
      date: day,
      document:
        e.customerAdjustment?.number ??
        e.inventoryDocument?.number ??
        e.supplierServiceDocument?.number ??
        e.serviceRecord?.invoiceNumber ??
        e.serviceRecord?.title ??
        (e.moneyTransaction
          ? 'Оплата / повернення'
          : e.openingBalance
            ? 'Початковий баланс'
            : 'Коригування'),
      debit: e.polarity === 'DEBIT' ? e.amount.toFixed(2) : '',
      credit: e.polarity === 'CREDIT' ? e.amount.toFixed(2) : '',
      balance: running.toFixed(2),
    })
  }
  const csv = [
    ['Акт звірки', party.displayNameSnapshot, input.from, input.through],
    ['Початкове сальдо', opening.toFixed(2)],
    ['Дата', 'Документ', 'Нараховано', 'Зменшення / оплата', 'Сальдо'],
    ...rows.map((r) => [r.date, r.document, r.debit, r.credit, r.balance]),
    ['Обороти', '', debit.toFixed(2), credit.toFixed(2)],
    ['Кінцеве сальдо', running.toFixed(2)],
  ]
    .map((r) => r.map(csvCell).join(';'))
    .join('\r\n')
  return {
    ...input,
    name: party.displayNameSnapshot,
    opening: opening.toFixed(2),
    closing: running.toFixed(2),
    debit: debit.toFixed(2),
    credit: credit.toFixed(2),
    rows,
    csv,
  }
}
