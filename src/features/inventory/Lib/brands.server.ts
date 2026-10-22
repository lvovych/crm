import { db } from '@/lib/db'

export async function assertSelectableBrand(id = 'brand_unknown') {
  const brand = await db.brand.findUnique({ where: { id } })
  if (!brand?.isActive) throw new Error('Brand is unavailable')
}
