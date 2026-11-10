'use server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { getCachedMembership } from '@/lib/cached-session'
import { hasPermission, PermissionAction as A, PermissionSubject as S } from '@/lib/permissions'
import { workshopTimeZone } from '@/lib/workshop-timezone'
import { zonedDayKey } from '@/lib/timezone'
import { settlementReport } from '@/features/settlements/actions'
import { settlementsEnabled } from '@/features/settlements/ledger'
import { isCredit } from '@/features/settlements/amounts'
import { projectCustomers } from './projection'
import type { Overview, PartyRow } from './types'

export async function mutualSettlementsReport(requestedDate?: string) {
  return withAuth(async (ctx): Promise<Overview> => {
    const member = ctx.isAdmin ? null : await getCachedMembership(ctx.userId)
    const can = (subject: S) =>
      ctx.isAdmin ||
      (member?.organizationId === ctx.organizationId &&
        hasPermission(member.customRole?.permissions ?? [], { action: A.READ, subject }))
    const customersAllowed = can(S.BILLING)
    const suppliersAllowed = can(S.SETTLEMENTS) && settlementsEnabled(ctx.organizationId)
    if (!customersAllowed && !suppliersAllowed)
      throw new Error('Немає доступу до взаєморозрахунків.')
    const zone = await workshopTimeZone(ctx.organizationId)
    const today = zonedDayKey(new Date(), zone)
    const asOf = z
      .string()
      .date()
      .refine((d) => d <= today, 'Дата не може бути в майбутньому.')
      .parse(requestedDate || today)
    const parties: PartyRow[] = []
    if (customersAllowed && asOf === today) {
      const records = await db.serviceRecord.findMany({
        where: { organizationId: ctx.organizationId },
        select: {
          id: true,
          title: true,
          invoiceNumber: true,
          status: true,
          totalAmount: true,
          cost: true,
          manuallyPaid: true,
          invoiceDueDate: true,
          invoiceDate: true,
          serviceDate: true,
          vehicleId: true,
          customer: { select: { id: true, name: true, phone: true, organizationId: true } },
          vehicle: {
            select: {
              customer: { select: { id: true, name: true, phone: true, organizationId: true } },
            },
          },
          _count: { select: { partItems: true, laborItems: true } },
          payments: { select: { amount: true, amountExact: true, date: true } },
        },
        orderBy: [{ serviceDate: 'desc' }, { id: 'asc' }],
      })
      parties.push(
        ...projectCustomers(
          records.map((r) => {
            const c = r.customer ?? r.vehicle?.customer
            return {
              ...r,
              hasPricedLines: r._count.partItems + r._count.laborItems > 0,
              customer: c?.organizationId === ctx.organizationId ? c : null,
              payments: r.payments.map((p) => ({
                ...p,
                amountExact: p.amountExact?.toString() ?? null,
              })),
            }
          }),
          today,
          zone
        )
      )
    }
    let supplierError: string | null = null
    if (suppliersAllowed) {
      const report = await settlementReport(asOf)
      if (!report.success || !report.data)
        supplierError = 'Не вдалося завантажити розрахунки постачальників. Повторіть спробу.'
      else {
        const contacts = await db.counterparty.findMany({
          where: { organizationId: ctx.organizationId, id: { in: report.data.map((p) => p.id) } },
          select: {
            id: true,
            contacts: {
              where: { organizationId: ctx.organizationId, phone: { not: null } },
              orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }],
              select: { phone: true },
              take: 1,
            },
          },
        })
        const phones = new Map(contacts.map((c) => [c.id, c.contacts[0]?.phone]))
        parties.push(
          ...report.data
            .filter((s) => !s.isArchived || s.rows.length || s.unknown.length)
            .map((s) => ({
              id: s.id,
              name: s.name,
              phone: phones.get(s.id) || '',
              kind: 'supplier' as const,
              archived: s.isArchived,
              debt: s.debt,
              advance: s.advance,
              overdue: s.overdue,
              expected: '0.00',
              documents: [
                ...s.rows
                  .filter((r) => r.active)
                  .map((r) => ({
                    id: r.id,
                    label: r.reference || (isCredit(r.kind) ? 'Оплата / аванс' : 'Зобов’язання'),
                    href: '/settlements?' + new URLSearchParams({ supplier: s.id, date: asOf }),
                    date: r.date,
                    due: r.due,
                    amount: r.amount,
                    paid: null,
                    debt: isCredit(r.kind) ? '0.00' : r.open,
                    advance: isCredit(r.kind) ? r.open : '0.00',
                    expected: '0.00',
                    reason: null,
                    provisional: false,
                  })),
                ...s.unknown.map((r) => ({
                  id: r.id,
                  label: r.number,
                  href: `/receipts/${r.id}`,
                  date: null,
                  due: null,
                  amount: r.total,
                  paid: null,
                  debt: '0.00',
                  advance: '0.00',
                  expected: '0.00',
                  reason: 'Накладна потребує звірки. Сума документа не є підтвердженим боргом.',
                  provisional: false,
                })),
              ],
            }))
        )
      }
    }
    return {
      today,
      asOf,
      customersAllowed,
      suppliersAllowed,
      customersHistoricalUnavailable: customersAllowed && asOf !== today,
      supplierError,
      parties,
    }
  })
}
