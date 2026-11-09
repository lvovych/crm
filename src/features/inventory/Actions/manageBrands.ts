'use server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { saveBrandRecord, setBrandAvailability } from '../Lib/saveBrandRecord'
import { withAuth } from '@/lib/with-auth'
import { getCachedMembership } from '@/lib/cached-session'
import { hasPermission, PermissionAction as A, PermissionSubject as S } from '@/lib/permissions'
import { revalidatePath } from 'next/cache'
const schema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(120),
})
const permission = (action: A) => ({ action, subject: S.BRANDS })
function refreshBrands() {
  revalidatePath('/directories/brands')
  revalidatePath('/inventory')
  revalidatePath('/receipts/new')
}
export async function brandDirectory() {
  return withAuth(
    async ({ userId, isAdmin }) => {
      const member = await getCachedMembership(userId)
      const can = (action: A) =>
        isAdmin || hasPermission(member?.customRole?.permissions ?? [], permission(action))
      return {
        canCreate: can(A.CREATE),
        canEdit: can(A.UPDATE),
        canDelete: can(A.DELETE),
        brands: await db.brand.findMany({
          select: { id: true, name: true, isActive: true },
          orderBy: { name: 'asc' },
        }),
      }
    },
    { requiredPermissions: [permission(A.READ)] }
  )
}
export async function saveBrand(input: unknown) {
  const editing = !!(input && typeof input === 'object' && 'id' in input && input.id)
  return withAuth(
    async () => {
      const data = schema.parse(input)
      if (data.id === 'brand_unknown') throw new Error('Системний бренд не можна змінювати.')
      // Renaming cannot change availability: that is a separate, permission-checked action.
      const brand = await db.$transaction((tx) => saveBrandRecord(tx, data))
      refreshBrands()
      return brand
    },
    { requiredPermissions: [permission(A.READ), permission(editing ? A.UPDATE : A.CREATE)] }
  )
}
export async function changeBrandAvailability(id: string, isActive: boolean) {
  return withAuth(
    async () => {
      z.string().min(1).parse(id)
      z.boolean().parse(isActive)
      const brand = await db.$transaction((tx) => setBrandAvailability(tx, id, isActive))
      refreshBrands()
      return brand
    },
    { requiredPermissions: [permission(A.READ), permission(isActive ? A.UPDATE : A.DELETE)] }
  )
}
