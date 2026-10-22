'use server'

import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'

/** Shared directory: authenticated read access only; maintained through SQL. */
export async function getBrands() {
  return withAuth(() =>
    db.brand.findMany({
      select: { id: true, name: true, isActive: true },
      orderBy: { name: 'asc' },
    })
  )
}
