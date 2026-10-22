import { z } from 'zod'
import { ledgerCommand, type LedgerContext, type LedgerDB } from './transaction'
import { reconciliation } from './reconciliation'
export const STOCK_CUTOVER_KEY = 'stockLedger.approvedCutover.v1'
const approval = z.object({
  effectiveDate: z.iso.date(),
  manifestChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  approvedById: z.string(),
  approvedAt: z.iso.datetime(),
})
export async function newRecordStockMode(
  client: {
    appSetting: {
      findUnique(args: {
        where: { organizationId_key: { organizationId: string; key: string } }
        select: { value: true }
      }): PromiseLike<{ value: string } | null>
    }
  },
  organizationId: string
): Promise<'LEGACY' | 'LEDGER'> {
  const setting = await client.appSetting.findUnique({
    where: { organizationId_key: { organizationId, key: STOCK_CUTOVER_KEY } },
    select: { value: true },
  })
  if (!setting) return 'LEGACY'
  approval.parse(JSON.parse(setting.value))
  if (process.env.STOCK_LEDGER_ENABLED !== 'true')
    throw new Error(
      'Складський облік організації вже переведено. Увімкніть модуль перед створенням нових нарядів.'
    )
  return 'LEDGER'
}
export async function approveStockCutover(db: LedgerDB, ctx: LedgerContext, raw: unknown) {
  const input = z
    .object({
      idempotencyKey: z.string().min(16).max(100),
      effectiveDate: z.iso.date(),
      manifestChecksum: z.string().regex(/^[a-f0-9]{64}$/),
      stockVerified: z.literal(true),
      supplierBalancesVerified: z.literal(true),
      maintenanceConfirmed: z.literal(true),
    })
    .parse(raw)
  return ledgerCommand(db, ctx, 'stock.cutover', input, async (tx) => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date())
    if (input.effectiveDate !== today)
      throw new Error('Перехід дозволений поточною датою після звірки та зупинки записів')
    if ((await reconciliation(tx, ctx)).length)
      throw new Error('Спочатку усуньте розбіжності складського журналу')
    if (
      await tx.appSetting.findUnique({
        where: {
          organizationId_key: { organizationId: ctx.organizationId, key: STOCK_CUTOVER_KEY },
        },
      })
    )
      throw new Error('Перехід уже виконаний; повторне перемикання заборонене')
    const config = approval.parse({
      ...input,
      approvedById: ctx.userId,
      approvedAt: new Date().toISOString(),
    })
    await tx.appSetting.create({
      data: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        key: STOCK_CUTOVER_KEY,
        value: JSON.stringify(config),
      },
    })
    return { id: ctx.organizationId, ...config }
  })
}
