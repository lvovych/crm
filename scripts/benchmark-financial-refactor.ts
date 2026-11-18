import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { prepareParts } from '../src/features/vehicles/Lib/saveServiceLines'
import { ledgerSummaries } from '../src/features/customer-ledger/summary'
import { staffBalances } from '../src/features/payroll/settlement-queries'
import type { TxClient } from '../src/lib/db'
const BASE = '334e7f2bcad6d24b1de093aa8b12ab8c6619e02f'
const size = (v: unknown) =>
  Buffer.byteLength(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? String(x) : x)))
let queryCount = 0
async function measure(fn: () => Promise<unknown>) {
  await fn()
  const times: number[] = []
  const counts: number[] = []
  let value: unknown
  for (let i = 0; i < 5; i++) {
    queryCount = 0
    const start = performance.now()
    value = await fn()
    times.push(performance.now() - start)
    counts.push(queryCount)
  }
  return {
    medianMs: Number(times.sort((a, b) => a - b)[2].toFixed(3)),
    payloadBytes: size(value),
    queries: counts[2],
  }
}
async function main() {
  const url = process.env.FINANCE_TEST_DATABASE_URL
  if (
    !url ||
    !['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.endsWith('_test')
  )
    throw new Error('Local *_test DB required')
  const dir = await mkdtemp(join(tmpdir(), 'crm-refactor-benchmark-'))
  const original = execFileSync(
    'git',
    ['show', BASE + ':src/features/vehicles/Lib/saveServiceLines.ts'],
    { encoding: 'utf8' }
  ).replace("'./lineDiscount'", "'" + process.cwd() + "/src/features/vehicles/Lib/lineDiscount'")
  await writeFile(join(dir, 'original.ts'), original)
  const old = await import(pathToFileURL(join(dir, 'original.ts')).href)
  const results: Record<string, unknown> = { baseline: BASE, node: process.version, samples: 5 }
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
    log: [{ emit: 'event', level: 'query' }],
  })
  db.$on('query', () => {
    queryCount++
  })
  try {
    for (const count of [500, 2000]) {
      const rows = Array.from({ length: count }, (_, i) => ({
        id: 'p' + i,
        name: 'Part' + i,
        quantity: 1,
        unitPrice: 10,
        total: 10,
        unitCost: 5,
        markupPercent: 100,
      }))
      const tx = { servicePart: { findMany: async () => rows } } as unknown as TxClient
      results['lineMatching' + count] = {
        before: await measure(() => old.prepareParts(tx, 'r', rows)),
        after: await measure(() => prepareParts(tx, 'r', rows)),
      }
    }
    const org = (await db.organization.create({ data: { name: 'Refactor benchmark' } })).id
    const documents = Array.from({ length: 200 }, (_, i) => ({
      id: crypto.randomUUID(),
      organizationId: org,
      label: 'Benchmark ' + i,
    }))
    await db.customerLedgerDocument.createMany({ data: documents })
    for (const doc of documents)
      await db.customerLedgerEvent.createMany({
        data: Array.from({ length: 100 }, (_, i) => ({
          organizationId: org,
          documentId: doc.id,
          kind: i ? 'payment' : 'created',
          effectiveDate: new Date('2026-01-01'),
          status: i ? null : 'completed',
          amount: i ? null : '100.00',
          chargeDelta: i ? '0' : '100',
          paidDelta: i ? '0.01' : '0',
          note: 'Benchmark detail '.repeat(10),
        })),
      })
    const oldRead = () =>
      db.customerLedgerDocument.findMany({
        where: { organizationId: org },
        include: {
          events: {
            where: { effectiveDate: { lte: new Date('2026-12-31') } },
            orderBy: { id: 'asc' },
          },
        },
      })
    results.customerSummary = {
      documents: 200,
      events: 20000,
      before: await measure(oldRead),
      after: await measure(() => ledgerSummaries(db as unknown as TxClient, org, '2026-12-31')),
    }
    const employees = await db.technician.createManyAndReturn({
      data: Array.from({ length: 100 }, (_, i) => ({ organizationId: org, name: 'Employee ' + i })),
    })
    for (const person of employees)
      await db.paySlip.createMany({
        data: Array.from({ length: 52 }, (_, i) => ({
          technicianId: person.id,
          start: new Date(Date.UTC(2025, 0, 1 + i * 7)),
          end: new Date(Date.UTC(2025, 0, 7 + i * 7)),
          total: '1000.01',
          actorId: 'benchmark',
          lines: Array.from({ length: 20 }, () => ({ name: 'Work', amount: '50.00' })),
        })),
      })
    results.staffSummary = {
      employees: 100,
      slips: 5200,
      before: await measure(() =>
        db.technician.findMany({
          where: { organizationId: org },
          include: {
            paySlips: { include: { allocations: true } },
            staffPayments: { include: { document: true, allocations: true } },
          },
        })
      ),
      after: await measure(() => staffBalances(db as unknown as TxClient, org)),
    }
    // Read-only synthetic movement relation isolates aggregation/transport cost
    // on identical 100k movements; it does not claim a production execution plan.
    const raw = () =>
      db.$queryRaw`SELECT DATE '2026-01-01' + (i % 365)::integer AS date, 0.01::numeric AS amount FROM generate_series(1,100000) i`
    const grouped = () =>
      db.$queryRaw`SELECT GREATEST(DATE '2026-01-01' + (i % 365)::integer,DATE '2026-06-01') AS date, SUM(0.01::numeric) AS amount FROM generate_series(1,100000) i GROUP BY 1`
    results.historicalBalance = {
      movements: 100000,
      fixture: 'synthetic PostgreSQL relation',
      before: await measure(raw),
      after: await measure(grouped),
    }
    results.reconciliationFixtureOrg = org
    process.stdout.write(JSON.stringify(results, null, 2) + '\n')
  } finally {
    await db.$disconnect()
    await rm(dir, { recursive: true, force: true })
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
