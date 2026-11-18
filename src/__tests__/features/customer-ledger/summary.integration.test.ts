// @vitest-environment node
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { ledgerSummaries } from '@/features/customer-ledger/summary'
import { projectLedger, type LedgerDocument } from '@/features/customer-ledger/projection'
import { staffBalances } from '@/features/payroll/settlement-queries'
import type { TxClient } from '@/lib/db'
const url = process.env.FINANCE_TEST_DATABASE_URL
describe.skipIf(!url)('summary reads on PostgreSQL', () => {
  let db: PrismaClient, org: string
  beforeAll(async () => {
    if (
      !url ||
      !['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
      !new URL(url).pathname.endsWith('_test')
    )
      throw new Error('Local test database required')
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
    org = (await db.organization.create({ data: { name: 'Summary parity' } })).id
  })
  afterAll(async () => {
    await db?.$disconnect()
  })
  it('matches historical projections including same-day order, backdates, payments and tenant scope', async () => {
    const doc = await db.customerLedgerDocument.create({
      data: { id: crypto.randomUUID(), organizationId: org, customerId: 'customer', label: 'Test' },
    })
    const inputs = [
      { kind: 'created', effectiveDate: new Date('2026-01-01'), status: 'pending', amount: 100 },
      { kind: 'payment', effectiveDate: new Date('2026-01-02'), paidDelta: 30 },
      {
        kind: 'completed',
        effectiveDate: new Date('2026-01-03'),
        status: 'completed',
        amount: 100,
        chargeDelta: 100,
      },
      {
        kind: 'adjusted',
        effectiveDate: new Date('2026-01-03'),
        status: 'completed',
        amount: 120,
        chargeDelta: 20,
      },
      { kind: 'payment', effectiveDate: new Date('2026-01-02'), paidDelta: 10 },
      {
        kind: 'cancelled',
        effectiveDate: new Date('2026-01-05'),
        status: 'cancelled',
        chargeDelta: -120,
      },
    ]
    for (const data of inputs)
      await db.customerLedgerEvent.create({
        data: { ...data, organizationId: org, documentId: doc.id },
      })
    const rows = await db.customerLedgerEvent.findMany({ where: { documentId: doc.id } })
    const original: LedgerDocument = {
      ...doc,
      events: rows.map((e) => ({
        id: String(e.id),
        kind: e.kind,
        date: e.effectiveDate.toISOString().slice(0, 10),
        recordedAt: e.recordedAt.toISOString(),
        chargeDelta: e.chargeDelta.toFixed(2),
        paidDelta: e.paidDelta.toFixed(2),
        amount: e.amount?.toFixed(2) ?? null,
        status: e.status,
        due: null,
        manualPaid: null,
        paymentId: null,
        sourceDate: null,
        actor: null,
        note: null,
      })),
    }
    for (const asOf of ['2025-12-31', '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-05']) {
      const summaries = await ledgerSummaries(db as unknown as TxClient, org, asOf)
      expect(projectLedger(summaries, new Map(), asOf, false)).toEqual(
        projectLedger(
          [{ ...original, eventCount: original.events.filter((e) => e.date <= asOf).length }],
          new Map(),
          asOf,
          false
        )
      )
    }
    expect(await ledgerSummaries(db as unknown as TxClient, 'foreign', '2026-01-05')).toEqual([])
    expect(await ledgerSummaries(db as unknown as TxClient, org, '2026-01-05', 'another')).toEqual(
      []
    )
  })
  it('returns exact all-time payroll balance without loading lines', async () => {
    const employee = await db.technician.create({ data: { organizationId: org, name: 'Balance' } })
    await db.paySlip.create({
      data: {
        technicianId: employee.id,
        start: new Date('2026-01-01'),
        end: new Date('2026-01-07'),
        lines: [],
        total: '100.01',
        actorId: 'test',
      },
    })
    await db.paySlip.create({
      data: {
        technicianId: employee.id,
        start: new Date('2026-01-08'),
        end: new Date('2026-01-14'),
        lines: [],
        total: '200',
        status: 'new',
        actorId: 'test',
      },
    })
    expect(await staffBalances(db as unknown as TxClient, org)).toEqual([
      { id: employee.id, name: 'Balance', balance: '100.01' },
    ])
    expect(await staffBalances(db as unknown as TxClient, 'foreign')).toEqual([])
  })
})
