'use server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { saveBrandRecord } from '../Lib/saveBrandRecord'
import { withAuth } from '@/lib/with-auth'
import { revalidatePath } from 'next/cache'
const schema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(120),
  isActive: z.boolean(),
})
export async function brandDirectory() {
  return withAuth(async ({ isSuperAdmin }) => ({
    canEdit: isSuperAdmin,
    brands: await db.brand.findMany({
      select: { id: true, name: true, isActive: true },
      orderBy: { name: 'asc' },
    }),
  }))
}
export async function saveBrand(input: unknown) {
  return withAuth(async ({ isSuperAdmin }) => {
    if (!isSuperAdmin) throw new Error('Спільний довідник брендів редагує системний адміністратор.')
    const data = schema.parse(input)
    if (data.id === 'brand_unknown') throw new Error('Системний бренд не можна змінювати.')
    const brand = await db.$transaction((tx) => saveBrandRecord(tx, data))
    revalidatePath('/directories/brands')
    revalidatePath('/inventory')
    return brand
  })
}
