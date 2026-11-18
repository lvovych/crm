import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { writeFile } from 'node:fs/promises'
import {
  reconcileInvoice,
  reconcilePosting,
  reconcileReturn,
  type Finding,
} from '../src/features/finance/reconciliation'
import { currentTransferred } from '../src/features/receipts/return-availability'
import type { TxClient } from '../src/lib/db'
const args = process.argv.slice(2)
const option = (key: string) => args[args.indexOf(key) + 1]
const org = args.includes('--organization') ? option('--organization') : ''
if (!org || !process.env.DATABASE_URL)
  throw new Error('DATABASE_URL and --organization ID are required')
const output = args.includes('--output') ? option('--output') : null
const limit = args.includes('--limit') ? Number(option('--limit')) : 10000
if (!Number.isInteger(limit) || limit < 1 || limit > 1000000) throw new Error('Invalid --limit')
async function main() {
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  })
  try {
    const report = await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`
        const findings: Finding[] = []
        const scanned: Record<string, number> = {}
        const truncated: string[] = []
        async function pages<T extends { id: string }>(
          name: string,
          load: (after: string | undefined, take: number) => Promise<T[]>,
          check: (rows: T[]) => Promise<void>
        ) {
          let after: string | undefined,
            count = 0
          while (count < limit) {
            const rows = await load(after, Math.min(200, limit - count))
            if (!rows.length) break
            await check(rows)
            count += rows.length
            after = rows.at(-1)!.id
          }
          if (count === limit && (await load(after, 1)).length) truncated.push(name)
          scanned[name] = count
        }
        await pages(
          'invoices',
          (after, take) =>
            tx.serviceRecord.findMany({
              where: { organizationId: org, ...(after ? { id: { gt: after } } : {}) },
              orderBy: { id: 'asc' },
              take,
              select: {
                id: true,
                subtotal: true,
                discountAmount: true,
                taxAmount: true,
                taxInclusive: true,
                totalAmount: true,
                partItems: { select: { total: true } },
                laborItems: { select: { total: true } },
              },
            }),
          async (rows) => {
            for (const r of rows)
              findings.push(
                ...reconcileInvoice({
                  ...r,
                  lineTotals: [...r.partItems, ...r.laborItems].map((l) => l.total),
                })
              )
          }
        )
        await pages(
          'postings',
          (after, take) =>
            tx.financialDocument.findMany({
              where: {
                organizationId: org,
                status: 'posted',
                ...(after ? { id: { gt: after } } : {}),
              },
              orderBy: { id: 'asc' },
              take,
              include: { entries: true, payment: true },
            }),
          async (rows) => {
            for (const r of rows)
              findings.push(
                ...reconcilePosting({
                  ...r,
                  amount: r.amount.toFixed(2),
                  entries: r.entries.map((e) => ({ ...e, amount: e.amount.toFixed(2) })),
                  paymentAmount: r.payment
                    ? (r.payment.amountExact?.toFixed(2) ?? r.payment.amount.toFixed(2))
                    : null,
                })
              )
          }
        )
        await pages(
          'receiptLines',
          (after, take) =>
            tx.supplierReceiptLine.findMany({
              where: { receipt: { organizationId: org }, ...(after ? { id: { gt: after } } : {}) },
              orderBy: { id: 'asc' },
              take,
              include: { returns: { where: { document: { status: 'posted' } } }, transfers: true },
            }),
          async (rows) => {
            const consumed = await currentTransferred(tx as TxClient, org, rows)
            for (const r of rows)
              findings.push(
                ...reconcileReturn({
                  id: r.id,
                  quantity: r.quantity.toString(),
                  amount: r.amount.toFixed(2),
                  returnedQuantity: r.returns
                    .reduce((s, l) => s.plus(l.quantity), r.quantity.mul(0))
                    .toString(),
                  returnedAmount: r.returns
                    .reduce((s, l) => s.plus(l.amount), r.amount.mul(0))
                    .toFixed(2),
                  consumedQuantity: consumed.get(r.id)!.toString(),
                })
              )
          }
        )
        return {
          organizationId: org,
          generatedAt: new Date().toISOString(),
          readOnly: true,
          scanned,
          truncated,
          findings,
          note: 'Diagnostic only. line-subtotal-review may include intentional legacy/base charges. Review findings; no data was changed.',
        }
      },
      { isolationLevel: 'RepeatableRead', timeout: 120000 }
    )
    const text = JSON.stringify(report, null, 2) + '\n'
    if (output) await writeFile(output, text)
    else process.stdout.write(text)
  } finally {
    await db.$disconnect()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
