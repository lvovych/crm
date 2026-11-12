// @vitest-environment node
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
const url = process.env.FINANCE_TEST_DATABASE_URL
const suite = url ? describe : describe.skip
suite('customer history on PostgreSQL without cash activation', () => {
  let db: PrismaClient, org: string, customer: string, user: string
  beforeAll(async () => {
    if (
      !url ||
      !['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
      !new URL(url).pathname.includes('test')
    )
      throw new Error('Local test database required')
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
    org = (await db.organization.create({ data: { name: `Customer ledger ${randomUUID()}` } })).id
    user = (
      await db.user.create({
        data: { name: 'Ledger tester', email: `ledger-${randomUUID()}@example.test` },
      })
    ).id
    customer = (
      await db.customer.create({
        data: { organizationId: org, userId: user, name: 'Original customer' },
      })
    ).id
  })
  afterAll(async () => {
    await db?.$disconnect()
  })
  const record = (tracked = true) =>
    db.serviceRecord.create({
      data: {
        title: 'Order',
        organizationId: org,
        customerId: customer,
        status: 'pending',
        totalAmount: 100,
        customerLedgerTracked: tracked,
      },
    })
  const events = (id: string) =>
    db.customerLedgerEvent.findMany({ where: { documentId: id }, orderBy: { id: 'asc' } })
  const payment = (id: string, amount: number, extra: object = {}) =>
    db.payment.create({
      data: { serviceRecordId: id, amount, method: 'cash', date: new Date(), ...extra },
    })
  it('leaves existing documents untracked and cash configuration untouched', async () => {
    const r = await record(false)
    await payment(r.id, 10)
    expect(await events(r.id)).toEqual([])
    expect(await db.financeSettings.count({ where: { organizationId: org } })).toBe(0)
    expect(await db.moneyEntry.count({ where: { organizationId: org } })).toBe(0)
  })
  it('records prepayment, completion, partial payment, correction and refund atomically', async () => {
    const r = await record()
    await payment(r.id, 20)
    await db.serviceRecord.update({ where: { id: r.id }, data: { status: 'completed' } })
    const p = await payment(r.id, 30)
    await db.payment.update({ where: { id: p.id }, data: { amount: 40 } })
    await payment(r.id, -10)
    const rows = await events(r.id)
    expect(rows.map((e) => e.kind)).toEqual([
      'created',
      'payment',
      'completed',
      'payment',
      'payment_reversed',
      'payment',
      'refund',
    ])
    expect(rows.reduce((n, e) => n + Number(e.chargeDelta), 0)).toBe(100)
    expect(rows.reduce((n, e) => n + Number(e.paidDelta), 0)).toBe(50)
  })
  it('retains reversals on payment deletion and forbids erasing history', async () => {
    const r = await record()
    const p = await payment(r.id, 20)
    await db.payment.delete({ where: { id: p.id } })
    expect((await events(r.id)).map((e) => e.paidDelta.toString())).toEqual(['0', '20', '-20'])
    await expect(
      db.customerLedgerEvent.deleteMany({ where: { documentId: r.id } })
    ).rejects.toThrow('не можна')
    await expect(db.serviceRecord.delete({ where: { id: r.id } })).rejects.toThrow('історію')
  })
  it('cancels and reopens with compensating obligations', async () => {
    const r = await record()
    for (const status of ['completed', 'cancelled', 'pending', 'completed'])
      await db.serviceRecord.update({ where: { id: r.id }, data: { status } })
    expect((await events(r.id)).map((e) => e.chargeDelta.toString())).toEqual([
      '0',
      '100',
      '-100',
      '0',
      '100',
    ])
  })
  it('does not emit financial events on contact or unrelated record changes', async () => {
    const r = await record()
    await db.customer.update({ where: { id: customer }, data: { name: 'Renamed', phone: '123' } })
    await db.serviceRecord.update({
      where: { id: r.id },
      data: { description: 'New comment', ledgerActorName: 'Actor' },
    })
    expect(await events(r.id)).toHaveLength(1)
    expect(
      (await db.customerLedgerDocument.findUniqueOrThrow({ where: { id: r.id } })).customerId
    ).toBe(customer)
  })
  it('locks customer identity even if the record customer is changed', async () => {
    const r = await record()
    const other = await db.customer.create({
      data: { organizationId: org, userId: user, name: 'Another' },
    })
    await db.serviceRecord.update({ where: { id: r.id }, data: { customerId: other.id } })
    expect(
      (await db.customerLedgerDocument.findUniqueOrThrow({ where: { id: r.id } })).customerId
    ).toBe(customer)
  })
  it('rejects toggling coverage and payment reassignment', async () => {
    const r = await record(),
      other = await record(),
      p = await payment(r.id, 10)
    await expect(
      db.serviceRecord.update({ where: { id: r.id }, data: { customerLedgerTracked: false } })
    ).rejects.toThrow('область')
    await expect(
      db.payment.update({ where: { id: p.id }, data: { serviceRecordId: other.id } })
    ).rejects.toThrow('переносити')
  })
  it('rolls back events with the business transaction', async () => {
    const r = await record()
    await expect(
      db.$transaction(async (tx) => {
        await tx.payment.create({
          data: { serviceRecordId: r.id, amount: 20, method: 'cash', date: new Date() },
        })
        throw new Error('rollback')
      })
    ).rejects.toThrow('rollback')
    expect(await events(r.id)).toHaveLength(1)
  })
  it.each([
    [1.005, '1.01'],
    [2.675, '2.68'],
    [0.1 + 0.2, '0.3'],
    [0.004, '0'],
    [0.005, '0.01'],
  ])('rounds %s deterministically to %s', async (amount, expected) => {
    const r = await record()
    await payment(r.id, amount as number)
    expect((await events(r.id))[1].paidDelta.toString()).toBe(expected)
  })
  it('prefers exact decimal amounts to legacy floating point', async () => {
    const r = await record()
    await payment(r.id, 1.005, { amountExact: '1.02' })
    expect((await events(r.id))[1].paidDelta.toString()).toBe('1.02')
  })
  it('preserves original backdated date while registering today and defers future payments', async () => {
    const r = await record()
    await payment(r.id, 10, { date: new Date('2000-01-01T12:00:00Z') })
    await payment(r.id, 20, { date: new Date('2099-01-01T12:00:00Z') })
    const rows = await events(r.id)
    expect(rows[1].sourceDate?.toISOString().slice(0, 10)).toBe('2000-01-01')
    expect(rows[1].effectiveDate.toISOString().slice(0, 10)).toBe(
      new Date().toISOString().slice(0, 10)
    )
    expect(rows[2].effectiveDate.toISOString().slice(0, 10)).toBe('2099-01-01')
  })
  it('rejects refunds exceeding payments and rolls back their events', async () => {
    const r = await record()
    await payment(r.id, 10)
    await expect(payment(r.id, -11)).rejects.toThrow('перевищує')
    expect(await events(r.id)).toHaveLength(2)
  })
  it('concurrent payments and duplicate provider retries create no duplicate events', async () => {
    const r = await record()
    await Promise.all([payment(r.id, 10), payment(r.id, 20)])
    const data = {
      serviceRecordId: r.id,
      amount: 30,
      method: 'card',
      date: new Date(),
      provider: 'test',
      externalId: randomUUID(),
    }
    await db.payment.createMany({ data: [data, data], skipDuplicates: true })
    expect(await events(r.id)).toHaveLength(4)
  })
})
