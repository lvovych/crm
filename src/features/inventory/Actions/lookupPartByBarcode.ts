'use server'
import { newRecordStockMode } from '@/features/stock-ledger/Lib/cutover'
import { catalogQuantities } from '@/features/stock-ledger/Lib/catalogReadModel'

import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { PermissionAction, PermissionSubject } from '@/lib/permissions'
import { normalizeBarcode } from '../Lib/barcode'

export async function lookupPartByBarcode(barcode: string) {
  return withAuth(
    async ({ organizationId }) => {
      // Scanned input goes through the same normalisation as stored barcodes, so
      // an exact match is enough. Combined with the (organizationId, barcode)
      // unique index this resolves to at most one part — previously a
      // case-insensitive `findFirst` could pick arbitrarily between duplicates.
      const normalized = normalizeBarcode(barcode)
      if (!normalized) return null

      const part = await db.inventoryPart.findFirst({
        where: {
          organizationId,
          barcode: normalized,
          isArchived: false,
        },
        select: {
          id: true,
          brand: { select: { name: true } },
          partNumber: true,
          barcode: true,
          name: true,
          description: true,
          unit: true,
          unitCost: true,
          sellPrice: true,
          quantity: true,
          category: true,
        },
      })
      if (part && (await newRecordStockMode(db, organizationId)) === 'LEDGER') {
        const quantities = await catalogQuantities(
          db as unknown as import('@/features/stock-ledger/Lib/transaction').LedgerDB,
          organizationId,
          [part.id]
        )
        return { ...part, quantity: quantities.get(part.id) ?? 0 }
      }
      return part
    },
    {
      requiredPermissions: [
        { action: PermissionAction.READ, subject: PermissionSubject.INVENTORY },
        ...(process.env.STOCK_LEDGER_ENABLED === 'true'
          ? [{ action: PermissionAction.READ, subject: PermissionSubject.STOCK_COST }]
          : []),
      ],
    }
  )
}
