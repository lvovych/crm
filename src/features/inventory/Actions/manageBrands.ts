'use server'
import { z } from 'zod'
import { db } from '@/lib/db'
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
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(724193)`
      const duplicate = await tx.brand.findFirst({
        where: {
          name: { equals: data.name, mode: 'insensitive' },
          ...(data.id ? { id: { not: data.id } } : {}),
        },
      })
      if (duplicate) throw new Error('Бренд із такою назвою вже існує.')
      const brand = data.id
        ? await tx.brand.update({
            where: { id: data.id },
            data: { name: data.name, isActive: data.isActive },
          })
        : await tx.brand.create({ data: { name: data.name, isActive: data.isActive } })
      revalidatePath('/directories/brands')
      revalidatePath('/inventory')
      return brand
    })
  })
}
