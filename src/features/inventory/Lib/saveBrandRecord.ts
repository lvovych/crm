import type { TxClient } from '@/lib/db'

// The advisory lock returns PostgreSQL void; cast it for Prisma's result decoder.
export async function saveBrandRecord(
  tx: TxClient,
  data: { id?: string; name: string; isActive: boolean }
) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(724193)::text`
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
  return brand
}
