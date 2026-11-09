import { randomUUID } from 'node:crypto'
import { Client } from 'pg'

// Only the disposable database reset by the E2E harness may receive these fixtures.
export async function receiptDb() {
  const connectionString = process.env.E2E_DATABASE_URL || ''
  const url = new URL(connectionString)
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/torqvoice_e2e') {
    throw new Error('Receipt browser fixtures require the disposable E2E database')
  }
  const db = new Client({ connectionString })
  await db.connect()
  return db
}
export async function receiptFixture() {
  const db = await receiptDb()
  try {
    const {
      rows: [owner],
    } = await db.query<{ organizationId: string; userId: string }>(
      `select m."organizationId", m."userId" from organization_members m join users u on u.id=m."userId" where u.email=$1 limit 1`,
      ['demo@torqvoice.com']
    )
    if (!owner) throw new Error('Missing E2E owner')
    const prefix = `E2E-R13-${randomUUID().slice(0, 8)}`
    const supplier = { id: randomUUID(), name: prefix + ' supplier' }
    await db.query(
      `insert into counterparties (id,"organizationId",name,"createdById","updatedAt") values ($1,$2,$3,$4,now())`,
      [supplier.id, owner.organizationId, supplier.name, owner.userId]
    )
    await db.query(
      `insert into supplier_profiles (id,"counterpartyId","organizationId") values ($3,$1,$2)`,
      [supplier.id, owner.organizationId, randomUUID()]
    )
    const brands = ['Alpha', 'Beta', 'Inactive'].map((name) => ({
      id: randomUUID(),
      name: prefix + ' ' + name,
      isActive: name !== 'Inactive',
    }))
    for (const brand of brands)
      await db.query(
        `insert into brands (id,name,"isActive","updatedAt") values ($1,$2,$3,now())`,
        [brand.id, brand.name, brand.isActive]
      )
    const part = { id: randomUUID(), partNumber: prefix + '-KNOWN', name: prefix + ' filter' }
    const parts = [
      { ...part, brandId: brands[0].id, unitCost: 12.3456, quantity: 10 },
      ...brands
        .slice(0, 2)
        .map((brand, i) => ({
          id: randomUUID(),
          partNumber: prefix + '-SHARED',
          name: prefix + ' shared ' + i,
          brandId: brand.id,
          unitCost: 20 + i,
          quantity: 0,
        })),
    ]
    for (const item of parts)
      await db.query(
        `insert into inventory_parts (id,"organizationId","userId","brandId","partNumber",name,unit,"unitCost",quantity,"updatedAt") values ($1,$2,$3,$4,$5,$6,'шт',$7,$8,now())`,
        [
          item.id,
          owner.organizationId,
          owner.userId,
          item.brandId,
          item.partNumber,
          item.name,
          item.unitCost,
          item.quantity,
        ]
      )
    return { prefix, supplier, brands, part, organizationId: owner.organizationId }
  } finally {
    await db.end()
  }
}
