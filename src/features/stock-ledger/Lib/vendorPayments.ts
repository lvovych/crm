import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { PrismaClient } from '@/generated/prisma/client'
import { D, moneyText } from './amounts'
import { postCustomerMoney } from './customerFinance'
import type { LedgerDB, Tx } from './transaction'
export const vendorAccountKey = (provider: string) => 'stockLedger.vendorAccount.' + provider
const inputSchema = z.object({
  serviceRecordId: z.string().min(1),
  provider: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  externalId: z.string().min(1).max(500),
  amount: z.number().finite().positive(),
  method: z.string().min(1).max(50),
  date: z.date().optional(),
  note: z.string().max(2000).nullish(),
})
/** Called only after the provider signature/status has been verified by the existing adapter.
 * Returns null for LEGACY so its existing unique Payment path remains unchanged. */
export async function ledgerVendorPayment(db: Pick<PrismaClient, '$transaction'>, raw: unknown) {
  const input = inputSchema.parse(raw)
  return db.$transaction(
    async (tx) => {
      const job = await tx.serviceRecord.findUniqueOrThrow({
        where: { id: input.serviceRecordId },
        include: { vehicle: { select: { customerId: true } } },
      })
      if (job.financeAccountingMode !== 'LEDGER') return null
      if (!job.organizationId) throw new Error('Organization is required for ledger payment')
      if (process.env.STOCK_LEDGER_ENABLED !== 'true')
        throw new Error('Ledger payments are disabled; retry after enabling the ledger')
      const organizationId = job.organizationId,
        org = { organizationId }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId},613))`
      const old = await tx.payment.findFirst({
        where: { serviceRecordId: job.id, provider: input.provider, externalId: input.externalId },
      })
      if (old) {
        if (!D(String(old.amount)).eq(String(input.amount)))
          throw new Error('Provider replay amount differs')
        return { id: old.id, created: false }
      }
      const key = createHash('sha256')
          .update(JSON.stringify([job.id, input.provider, input.externalId]))
          .digest('hex'),
        existing = await tx.ledgerCommand.findUnique({
          where: { organizationId_scope_key: { ...org, scope: 'customer.money', key } },
        }),
        amount = moneyText.parse(String(input.amount))
      if (existing) {
        const result = existing.response as { id: string; amount: string }
        if (!D(result.amount).eq(amount)) throw new Error('Provider replay amount differs')
        return { id: result.id, created: false }
      }
      const config = await tx.appSetting.findUnique({
        where: { organizationId_key: { ...org, key: vendorAccountKey(input.provider) } },
      })
      if (!config?.value)
        throw new Error('Спочатку налаштуйте рахунок для платіжного провайдера ' + input.provider)
      // Dedicated non-login actor: a webhook must never impersonate the workshop owner.
      const systemId =
        'ledger-webhook-' + createHash('sha256').update(organizationId).digest('hex').slice(0, 24)
      await tx.user.upsert({
        where: { id: systemId },
        create: {
          id: systemId,
          name: 'Платіжні інтеграції (система)',
          email: systemId + '@internal.invalid',
        },
        update: {},
      })
      const ctx = { organizationId, userId: systemId },
        nested = {
          $transaction: async (fn: (tx: Tx) => Promise<unknown>) => fn(tx),
        } as unknown as LedgerDB,
        date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(
          input.date ?? new Date()
        )
      const result = await postCustomerMoney(nested, ctx, {
        idempotencyKey: key,
        serviceRecordId: job.id,
        accountId: config.value,
        amount,
        direction: 'IN',
        effectiveAt: date,
        method: input.method,
        note: `${input.provider}: ${input.externalId}${input.note ? ' · ' + input.note : ''}`.slice(
          0,
          2000
        ),
        confirmed: true,
      })
      return { id: result.id, created: true }
    },
    { maxWait: 10000, timeout: 20000 }
  )
}
