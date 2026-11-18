'use server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { PermissionAction as A, PermissionSubject as S } from '@/lib/permissions'
import type { LedgerEvent } from './projection'

export async function documentHistory(documentId: string, asOf: string, before?: string) {
  return withAuth(
    async ({ organizationId }) => {
      z.string().min(1).max(200).parse(documentId)
      z.string().date().parse(asOf)
      if (before)
        z.string()
          .regex(/^\d{1,19}$/)
          .parse(before)
      const rows = await db.customerLedgerEvent.findMany({
        where: {
          organizationId,
          documentId,
          effectiveDate: { lte: new Date(asOf) },
          ...(before ? { id: { lt: BigInt(before) } } : {}),
        },
        orderBy: { id: 'desc' },
        take: 51,
      })
      const page = rows.slice(0, 50)
      const events: LedgerEvent[] = page.map((e) => ({
        id: String(e.id),
        kind: e.kind,
        date: e.effectiveDate.toISOString().slice(0, 10),
        recordedAt: e.recordedAt.toISOString(),
        chargeDelta: e.chargeDelta.toFixed(2),
        paidDelta: e.paidDelta.toFixed(2),
        amount: e.amount?.toFixed(2) ?? null,
        status: e.status,
        due: e.due?.toISOString().slice(0, 10) ?? null,
        manualPaid: e.manualPaid,
        paymentId: e.paymentId,
        sourceDate: e.sourceDate?.toISOString().slice(0, 10) ?? null,
        actor: e.actorName ?? e.actorId,
        note: e.note,
      }))
      return { events, next: rows.length > 50 ? String(page.at(-1)!.id) : null }
    },
    { requiredPermissions: [{ action: A.READ, subject: S.BILLING }] }
  )
}
