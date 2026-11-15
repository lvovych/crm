import type { TxClient } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'

// Both posting paths hold the organization's finance lock.
export async function allocatePayments(tx: TxClient, technicianId: string) {
  const slips = await tx.paySlip.findMany({
    where: { technicianId, status: 'completed' },
    orderBy: { start: 'asc' },
    include: { allocations: { where: { payment: { document: { reversal: null } } } } },
  })
  const open = slips.map((s) => ({
    id: s.id,
    remaining: s.allocations.reduce((sum, a) => sum.minus(a.amount), s.total),
  }))
  const payments = await tx.staffPayment.findMany({
    where: { technicianId, document: { reversal: null } },
    orderBy: [{ document: { date: 'asc' } }, { id: 'asc' }],
    include: { document: true, allocations: true },
  })
  for (const p of payments) {
    let available = p.allocations.reduce((sum, a) => sum.minus(a.amount), p.document.amount)
    for (const slip of open) {
      if (available.lte(0)) break
      if (slip.remaining.lte(0)) continue
      const amount = Prisma.Decimal.min(slip.remaining, available)
      await tx.staffAllocation.upsert({
        where: { slipId_paymentId: { slipId: slip.id, paymentId: p.id } },
        create: { slipId: slip.id, paymentId: p.id, amount },
        update: { amount: { increment: amount } },
      })
      slip.remaining = slip.remaining.minus(amount)
      available = available.minus(amount)
    }
  }
}
