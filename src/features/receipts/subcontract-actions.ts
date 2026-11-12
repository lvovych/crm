'use server'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { PermissionAction as A, PermissionSubject as S } from '@/lib/permissions'
import { revalidatePath } from 'next/cache'
import { receiptsEnabled } from './enabled'
import { getDocumentLockSettings } from '@/lib/document-lock.server'
import { draftSubcontractReceipts, assignReceiptService } from './subcontract-ledger'
const edit = { action: A.UPDATE, subject: S.SERVICES }
export async function contractorOptions() {
  return withAuth(
    async ({ organizationId }) =>
      receiptsEnabled(organizationId)
        ? db.counterparty.findMany({
            where: { organizationId, isArchived: false, supplierProfile: { isNot: null } },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
          })
        : [],
    { requiredPermissions: [edit, { action: A.READ, subject: S.SUPPLIERS }] }
  )
}
export async function createServiceReceipts(orderId: string) {
  return withAuth(
    async ({ organizationId, userId }) => {
      if (!receiptsEnabled(organizationId)) throw new Error('Надходження вимкнено.')
      const ids = await db.$transaction((tx) =>
        draftSubcontractReceipts(tx, organizationId, userId, orderId)
      )
      revalidatePath('/receipts', 'layout')
      return ids
    },
    { requiredPermissions: [edit, { action: A.CREATE, subject: S.RECEIPTS }] }
  )
}
export async function linkServiceReceipt(
  orderId: string,
  lineId: string,
  laborId: string | null,
  sale: string
) {
  return withAuth(
    async ({ organizationId }) => {
      if (!receiptsEnabled(organizationId)) throw new Error('Надходження вимкнено.')
      const settings = await getDocumentLockSettings(organizationId)
      await db.$transaction((tx) =>
        assignReceiptService(tx, organizationId, orderId, lineId, laborId, sale, settings)
      )
      revalidatePath('/receipts', 'layout')
      revalidatePath('/vehicles/[id]/service/[serviceId]', 'page')
      return true
    },
    {
      requiredPermissions: [
        edit,
        { action: A.READ, subject: S.RECEIPTS },
        { action: A.READ, subject: S.WORK_ORDERS },
      ],
    }
  )
}
