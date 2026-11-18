// @vitest-environment node
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import type { TxClient } from '@/lib/db'
const state = vi.hoisted(() => ({ db: null as unknown as PrismaClient }))
vi.mock('@/lib/db', () => ({
  db: new Proxy(
    {},
    {
      get: (_target, key) => {
        const value = Reflect.get(state.db, key)
        return typeof value === 'function' ? value.bind(state.db) : value
      },
    }
  ),
}))
vi.mock('@/lib/workshop-timezone', () => ({ workshopTimeZone: async () => 'Europe/Kyiv' }))
import { executeRecurringInvoice } from '@/features/billing/Lib/recurringExecution'
import { nextInvoiceNumber } from '@/lib/invoice-number.server'
const url = process.env.FINANCE_TEST_DATABASE_URL
describe.skipIf(!url)('invoice execution on PostgreSQL', () => {
  let org: string, vehicle: string, user: string
  const due = new Date('2026-10-01T00:00:00Z'),
    now = new Date('2026-11-18T12:00:00Z')
  beforeAll(async () => {
    if (
      !url ||
      !['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
      !new URL(url).pathname.endsWith('_test')
    )
      throw new Error('Local test database required')
    state.db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
    org = (await state.db.organization.create({ data: { name: 'Recurring ' + randomUUID() } })).id
    user = (
      await state.db.user.create({
        data: { name: 'Tester', email: randomUUID() + '@example.test' },
      })
    ).id
    vehicle = (
      await state.db.vehicle.create({
        data: { organizationId: org, userId: user, make: 'Test', model: 'Car', year: 2020 },
      })
    ).id
  })
  afterAll(async () => {
    await state.db?.$disconnect()
  })
  const template = (frequency = 'monthly') =>
    state.db.recurringInvoice.create({
      data: {
        vehicleId: vehicle,
        title: 'Recurring',
        frequency,
        nextRunDate: due,
        templateParts: { create: { name: 'Part', quantity: 2.5, unitPrice: 19.99 } },
        templateLabor: {
          create: { description: 'Work', hours: 2.5, rate: 19.99, pricingType: 'fixed' },
        },
      },
    })
  it('concurrent cron/manual execution and stale retries bill one observed period', async () => {
    const ri = await template()
    const results = await Promise.all([
      executeRecurringInvoice(ri, org, now),
      executeRecurringInvoice(ri, org, now),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await executeRecurringInvoice(ri, org, now)).toBeNull()
    const row = await state.db.serviceRecord.findUniqueOrThrow({
      where: { id: results.find(Boolean)!.id },
      include: { partItems: true, laborItems: true },
    })
    expect(row.subtotal).toBe(99.96)
    expect(row.laborItems[0]).toMatchObject({ total: 49.98, pricingType: 'fixed' })
    expect(
      (await state.db.recurringInvoice.findUniqueOrThrow({ where: { id: ri.id } })).runCount
    ).toBe(1)
  })
  it('does not consume another tenant template or an invalid period', async () => {
    const ri = await template('invalid')
    const before = await state.db.serviceRecord.count({ where: { organizationId: org } })
    expect(await executeRecurringInvoice(ri, 'foreign', now)).toBeNull()
    await expect(executeRecurringInvoice(ri, org, now)).rejects.toThrow('frequency')
    expect(await state.db.serviceRecord.count({ where: { organizationId: org } })).toBe(before)
    expect(
      (await state.db.recurringInvoice.findUniqueOrThrow({ where: { id: ri.id } })).runCount
    ).toBe(0)
  })
  it('rolls back reservations and allocates unique numbers across concurrent writers', async () => {
    let reserved = ''
    await expect(
      state.db.$transaction(async (tx) => {
        reserved = await nextInvoiceNumber(tx as TxClient, org, 'UTC', now)
        throw new Error('abort')
      })
    ).rejects.toThrow('abort')
    const create = () =>
      state.db.$transaction(
        async (tx) => {
          const invoiceNumber = await nextInvoiceNumber(tx as TxClient, org, 'UTC', now)
          return tx.serviceRecord.create({
            data: { organizationId: org, title: 'Concurrent', invoiceNumber },
          })
        },
        { timeout: 15000 }
      )
    const records = await Promise.all(Array.from({ length: 6 }, create))
    expect(new Set(records.map((r) => r.invoiceNumber)).size).toBe(6)
    expect(records.map((r) => r.invoiceNumber)).toContain(reserved)
  })
  it('bootstraps from all imports, honors a jump once, and keeps incrementing after prefix changes', async () => {
    const other = (await state.db.organization.create({ data: { name: 'Numbering' } })).id
    await state.db.serviceRecord.create({
      data: { organizationId: other, title: 'Imported', invoiceNumber: 'OLD-9000' },
    })
    await state.db.serviceRecord.create({
      data: { organizationId: other, title: 'Newer without number' },
    })
    const setting = (key: string, value: string) =>
      state.db.appSetting.upsert({
        where: { organizationId_key: { organizationId: other, key } },
        create: { organizationId: other, userId: user, key, value },
        update: { value },
      })
    const next = () =>
      state.db.$transaction((tx) => nextInvoiceNumber(tx as TxClient, other, 'Europe/Kyiv', now))
    expect(await next()).toBe('2026-9001')
    await setting('workshop.invoiceStartNumber', '10000')
    await setting('workshop.invoicePrefix', '{year}-{month}-')
    expect(await next()).toBe('2026-11-10000')
    expect(
      (
        await state.db.appSetting.findUniqueOrThrow({
          where: {
            organizationId_key: { organizationId: other, key: 'workshop.invoiceStartNumber' },
          },
        })
      ).value
    ).toBe('')
    await setting('workshop.invoicePrefix', 'NEW-')
    expect(await next()).toBe('NEW-10001')
    await state.db.serviceRecord.create({
      data: { organizationId: other, title: 'Manual collision', invoiceNumber: 'NEW-10002' },
    })
    expect(await next()).toBe('NEW-10003')
  })
  it('honors an explicit low starting number on a new installation', async () => {
    const other = (await state.db.organization.create({ data: { name: 'Low start' } })).id
    await state.db.appSetting.create({
      data: { organizationId: other, userId: user, key: 'workshop.invoiceStartNumber', value: '5' },
    })
    const next = () =>
      state.db.$transaction((tx) => nextInvoiceNumber(tx as TxClient, other, 'UTC', now))
    expect(await next()).toBe('2026-5')
    expect(await next()).toBe('2026-6')
  })
})
