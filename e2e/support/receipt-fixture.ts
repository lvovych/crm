import { randomUUID } from 'node:crypto'
import { PrismaClient } from '../../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

// Only the disposable database reset by the E2E harness may receive these fixtures.
export function receiptDb() {
  const connectionString = process.env.E2E_DATABASE_URL || ''
  const url = new URL(connectionString)
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/torqvoice_e2e') {
    throw new Error('Receipt browser fixtures require the disposable E2E database')
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}
export async function receiptFixture() {
  const db = receiptDb()
  try {
    const owner = await db.organizationMember.findFirstOrThrow({
      where: { user: { email: 'demo@torqvoice.com' } },
    })
    const prefix = `E2E-R13-${randomUUID().slice(0, 8)}`
    const supplier = await db.counterparty.create({
      data: {
        name: prefix + ' supplier',
        organizationId: owner.organizationId,
        createdById: owner.userId,
        supplierProfile: { create: {} },
      },
    })
    const brands = await Promise.all(
      ['Alpha', 'Beta', 'Inactive'].map((name) =>
        db.brand.create({ data: { name: prefix + ' ' + name, isActive: name !== 'Inactive' } })
      )
    )
    const part = await db.inventoryPart.create({
      data: {
        organizationId: owner.organizationId,
        userId: owner.userId,
        brandId: brands[0].id,
        partNumber: prefix + '-KNOWN',
        name: prefix + ' filter',
        unit: 'шт',
        unitCost: 12.3456,
        quantity: 10,
      },
    })
    await Promise.all(
      brands.slice(0, 2).map((brand, i) =>
        db.inventoryPart.create({
          data: {
            organizationId: owner.organizationId,
            userId: owner.userId,
            brandId: brand.id,
            partNumber: prefix + '-SHARED',
            name: prefix + ' shared ' + i,
            unit: 'шт',
            unitCost: 20 + i,
            quantity: 0,
          },
        })
      )
    )
    return { prefix, supplier, brands, part, organizationId: owner.organizationId }
  } finally {
    await db.$disconnect()
  }
}
