import { chargeSchema, openingBalanceSchema, subcontractSchema } from './contracts'
import { D, cents } from './amounts'
import {
  assertPeriod,
  ledgerCommand,
  metadata,
  type LedgerContext,
  type LedgerDB,
} from './transaction'
import { nextDocumentNumber } from './numbers'
export function createFinance(db: LedgerDB, ctx: LedgerContext) {
  const org = { organizationId: ctx.organizationId },
    meta = metadata(ctx)
  return {
    async postSubcontract(raw: unknown) {
      const input = subcontractSchema.parse(raw)
      return ledgerCommand(db, ctx, 'subcontract.post', input, async (tx) => {
        await assertPeriod(tx, ctx, input.effectiveAt, false)
        const supplier = await tx.supplier.findFirst({
          where: { ...org, id: input.supplierId, archivedAt: null },
        })
        if (!supplier || supplier.kind === 'GOODS') throw new Error('Виберіть постачальника послуг')
        const total = input.lines.reduce(
          (s, l) => s.plus(cents(D(l.quantity).mul(l.unitCost))),
          D(0)
        )
        if (total.lte(0)) throw new Error('Сума послуги має бути додатною')
        const doc = await tx.supplierServiceDocument.create({
          data: {
            ...meta,
            supplierId: supplier.id,
            number: await nextDocumentNumber(tx, ctx, 'SC', input.effectiveAt),
            externalNumber: input.externalNumber,
            effectiveAt: input.effectiveAt,
            dueDate: input.dueDate,
            totalAmount: total,
          },
        })
        for (const line of input.lines) {
          const job = await tx.serviceRecord.findFirst({
            where: { ...org, id: line.serviceRecordId },
          })
          if (!job) throw new Error('Наряд не знайдений')
          await tx.supplierServiceLine.create({
            data: {
              ...meta,
              documentId: doc.id,
              serviceRecordId: job.id,
              descriptionSnapshot: line.description,
              quantity: line.quantity,
              unitCost: line.unitCost,
              totalAmount: cents(D(line.quantity).mul(line.unitCost)),
            },
          })
        }
        const party = await tx.settlementParty.findUniqueOrThrow({
          where: { organizationId_supplierId: { ...org, supplierId: supplier.id } },
        })
        await tx.settlementEntry.create({
          data: {
            ...meta,
            partyId: party.id,
            side: 'AP',
            polarity: 'DEBIT',
            amount: total,
            effectiveAt: input.effectiveAt,
            dueDate: input.dueDate,
            supplierServiceDocumentId: doc.id,
            operationKey: 'subcontract:' + doc.id,
          },
        })
        return { id: doc.id, total: total.toFixed(2) }
      })
    },
    async openingBalance(raw: unknown) {
      const input = openingBalanceSchema.parse(raw)
      return ledgerCommand(db, ctx, 'balance.opening', input, async (tx) => {
        await assertPeriod(tx, ctx, input.effectiveAt, false)
        if (input.partyId) {
          const party = await tx.settlementParty.findFirst({ where: { ...org, id: input.partyId } })
          if (!party || !input.polarity || input.side !== (party.kind === 'SUPPLIER' ? 'AP' : 'AR'))
            throw new Error('Некоректна сторона початкового балансу')
        } else if (
          !(await tx.cashAccount.findFirst({
            where: { ...org, id: input.accountId, archivedAt: null },
          }))
        )
          throw new Error('Рахунок не знайдений')
        const opening = await tx.openingBalance.create({
          data: {
            ...meta,
            partyId: input.partyId,
            accountId: input.accountId,
            side: input.partyId ? input.side : null,
            polarity: input.partyId ? input.polarity : null,
            amount: input.amount,
            asOfDate: input.effectiveAt,
            sourceNote: input.sourceNote,
            batchKey: input.batchKey,
          },
        })
        if (input.partyId)
          await tx.settlementEntry.create({
            data: {
              ...meta,
              partyId: input.partyId,
              side: input.side!,
              polarity: input.polarity!,
              amount: input.amount,
              effectiveAt: input.effectiveAt,
              openingBalanceId: opening.id,
              operationKey: 'opening:' + opening.id,
            },
          })
        else
          await tx.cashLedgerEntry.create({
            data: {
              ...meta,
              accountId: input.accountId!,
              openingBalanceId: opening.id,
              amountDelta: input.amount,
              effectiveAt: input.effectiveAt,
              operationKey: 'opening:' + opening.id,
            },
          })
        return { id: opening.id, amount: input.amount }
      })
    },
    async issueCustomerCharge(raw: unknown) {
      const input = chargeSchema.parse(raw)
      return ledgerCommand(db, ctx, 'customer.charge', input, async (tx) => {
        await assertPeriod(tx, ctx, input.effectiveAt, false)
        const job = await tx.serviceRecord.findFirst({
          where: { ...org, id: input.serviceRecordId, financeAccountingMode: 'LEDGER' },
        })
        const customer = await tx.customer.findFirst({ where: { ...org, id: input.customerId } })
        if (!job || !customer)
          throw new Error('Наряд нового фінансового обліку або клієнт не знайдені')
        if (await tx.settlementEntry.findFirst({ where: { ...org, serviceRecordId: job.id } }))
          throw new Error('Рахунок уже виставлений. Потрібен коригувальний документ')
        const amount = D(String(job.totalAmount))
        if (amount.decimalPlaces() > 2)
          throw new Error('Сума наряду потребує звірки округлення до копійок')
        if (amount.lte(0)) throw new Error('Сума рахунку має бути додатною')
        const party = await tx.settlementParty.upsert({
          where: { organizationId_customerId: { ...org, customerId: customer.id } },
          create: {
            ...meta,
            kind: 'CUSTOMER',
            customerId: customer.id,
            displayNameSnapshot: customer.name,
          },
          update: {},
        })
        const entry = await tx.settlementEntry.create({
          data: {
            ...meta,
            partyId: party.id,
            side: 'AR',
            polarity: 'DEBIT',
            amount,
            effectiveAt: input.effectiveAt,
            dueDate: input.dueDate,
            serviceRecordId: job.id,
            operationKey: 'charge:' + job.id,
          },
        })
        await tx.serviceRecord.update({
          where: { id: job.id },
          data: {
            ledgerFinancialSnapshot: {
              version: 1,
              partyId: party.id,
              total: amount.toFixed(2),
              currency: 'UAH',
              entryId: entry.id,
            },
          },
        })
        return { id: entry.id, amount: amount.toFixed(2), partyId: party.id }
      })
    },
  }
}
