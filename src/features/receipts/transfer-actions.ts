'use server'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { PermissionAction as A, PermissionSubject as S } from '@/lib/permissions'
import { receiptsEnabled } from './enabled'
import { transferReceiptGoods } from './transfer-ledger'
import { getDocumentLockSettings } from '@/lib/document-lock.server'
import { onInventoryChanged } from '@/features/inventory/Lib/onInventoryChanged'
import { revalidatePath } from 'next/cache'
import { availableQuantity } from './transfer-schema'
import { resolvePartPrice } from '@/features/inventory/Lib/partPricing'
import { SETTING_KEYS } from '@/features/settings/Schema/settingsSchema'
const permissions = [
  { action: A.READ, subject: S.RECEIPTS },
  { action: A.UPDATE, subject: S.SERVICES },
  { action: A.READ, subject: S.WORK_ORDERS },
]
export async function receiptTransferOptions(receiptId: string) {
  return withAuth(
    async ({ organizationId }) => {
      if (!receiptsEnabled(organizationId)) throw new Error('Надходження вимкнено.')
      const receipt = await db.supplierReceipt.findFirstOrThrow({
        where: { id: receiptId, organizationId },
        include: {
          lines: {
            orderBy: { position: 'asc' },
            include: { part: true, transfers: { orderBy: { createdAt: 'asc' } } },
          },
        },
      })
      const settings = await db.appSetting.findMany({
        where: {
          organizationId,
          key: {
            in: [
              SETTING_KEYS.PARTS_DEFAULT_MARKUP_PERCENT,
              SETTING_KEYS.PARTS_MARKUP_APPLIES_TO_INVENTORY,
            ],
          },
        },
      })
      const setting = (key: string) => settings.find((s) => s.key === key)?.value
      const orders = await db.serviceRecord.findMany({
        where: {
          organizationId,
          vehicleId: { not: null },
          status: { in: ['pending', 'in-progress', 'waiting-parts'] },
        },
        select: {
          id: true,
          title: true,
          laborItems: { where: { subcontract: { supplierId: receipt.supplierId, receiptLineId: null } }, select: { id: true, description: true } },
          invoiceNumber: true,
          vehicle: { select: { make: true, model: true, licensePlate: true } },
        },
        orderBy: { createdAt: 'desc' },
      })
      return {
        lines: receipt.lines
          .filter((l) => l.kind === 'part' && l.part)
          .map((l) => ({
            id: l.id,
            name: l.name,
            article: l.article || '',
            unit: l.unit,
            received: l.quantity.toString(),
            available: availableQuantity(
              l.quantity.toString(),
              l.transfers.map((t) => t.quantity.toString())
            ),
            stock: l.part!.quantity,
            unitPrice: String(
              resolvePartPrice(l.part!, {
                defaultMarkupPercent: Number(
                  setting(SETTING_KEYS.PARTS_DEFAULT_MARKUP_PERCENT) || 0
                ),
                markupAppliesToInventory:
                  setting(SETTING_KEYS.PARTS_MARKUP_APPLIES_TO_INVENTORY) === 'true',
              }).unitPrice
            ),
            transfers: l.transfers.map((t) => ({
              id: t.id,
              label: t.serviceRecordLabel,
              quantity: t.quantity.toString(),
              href: t.vehicleId
                ? `/vehicles/${t.vehicleId}/service/${t.serviceRecordId}`
                : `/sales/${t.serviceRecordId}`,
            })),
          })),
        orders: orders.map((o) => ({
          id: o.id,
          works: o.laborItems,
          label: [
            o.invoiceNumber || o.title,
            o.vehicle?.licensePlate,
            o.vehicle?.make,
            o.vehicle?.model,
          ]
            .filter(Boolean)
            .join(' · '),
        })),
      }
    },
    { requiredPermissions: permissions }
  )
}
export async function transferFromReceipt(input: unknown) {
  return withAuth(
    async ({ organizationId, userId }) => {
      if (!receiptsEnabled(organizationId)) throw new Error('Надходження вимкнено.')
      const settings = await getDocumentLockSettings(organizationId)
      const result = await db.$transaction(
        (tx) => transferReceiptGoods(tx, organizationId, userId, input, settings),
        { timeout: 30000 }
      )
      await onInventoryChanged(organizationId)
      revalidatePath('/receipts', 'layout')
      revalidatePath('/work-orders')
      revalidatePath(`/vehicles/${result.vehicleId}/service/${result.serviceRecordId}`)
      return result
    },
    { requiredPermissions: permissions }
  )
}
