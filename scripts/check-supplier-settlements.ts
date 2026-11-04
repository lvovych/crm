// Use a seeded local *_test database. --review preserves the worked example for manual QA.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { applyOperation, operation } from '../src/features/settlements/operations'
import { workshopDay, hryvnia, remaining } from '../src/features/settlements/amounts'
import { transitionReceipt } from '../src/features/receipts/ledger'
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
}).$extends({ query: {} })
async function check() {
  const url = new URL(process.env.DATABASE_URL ?? '')
  assert(
    ['localhost', '127.0.0.1'].includes(url.hostname) &&
      (url.pathname.endsWith('_test') || url.pathname === '/torqvoice_e2e')
  )
  const { organizationId, userId } = await db.organizationMember.findFirstOrThrow({
    where: { role: 'owner' },
  })
  assert(
    process.env.SUPPLIER_SETTLEMENT_ORGANIZATIONS?.split(',').some(
      (s) => s === '*' || s === organizationId
    )
  )
  const demo = process.argv.includes('--review')
  const supplier = await db.counterparty.create({
    data: {
      organizationId,
      createdById: userId,
      name: demo ? 'Демо · Розрахунки R3' : 'QA ' + randomUUID(),
      supplierProfile: { create: { paymentTermDays: 10 } },
    },
  })
  const scope = { organizationId, supplierId: supplier.id }
  const date = workshopDay()
  const apply = (d: unknown, id: string = randomUUID()) =>
    db.$transaction((tx) =>
      applyOperation(tx, organizationId, supplier.id, userId, id, operation.parse(d))
    )
  const pay = (amount: string, target?: string, id: string = randomUUID()) =>
    apply({ op: 'payment', amount, date, method: 'bank', reference: 'Тест', note: '', target }, id)
  const part = await db.inventoryPart.create({
    data: { organizationId, userId, name: 'Демо · Фільтр R3', unit: 'шт', quantity: 3 },
  })
  const receipt = await db.supplierReceipt.create({
    data: {
      ...scope,
      number: demo ? 'R3-001' : randomUUID(),
      createdById: userId,
      documentDate: new Date(date),
      receivedDate: new Date(date),
      lines: {
        create: [
          {
            position: 0,
            partId: part.id,
            kind: 'part',
            article: 'R3-F',
            name: part.name,
            unit: 'шт',
            quantity: 5,
            unitPrice: 200,
            amount: 1000,
          },
          {
            position: 1,
            kind: 'service',
            name: 'Доставка',
            unit: 'посл.',
            quantity: 1,
            unitPrice: 150,
            amount: 150,
          },
        ],
      },
    },
  })
  const balance = async (id: string) => {
    const e = await db.supplierEntry.findUniqueOrThrow({
      where: { id },
      include: { debits: true, credits: true },
    })
    return hryvnia(remaining(e, [...e.debits, ...e.credits], date))
  }
  let preserve = false
  try {
    const credit = randomUUID()
    await Promise.all([pay('300', undefined, credit), pay('300', undefined, credit)])
    assert.equal(await db.supplierEntry.count({ where: scope }), 1)
    await db.$transaction((tx) =>
      transitionReceipt(tx, organizationId, userId, receipt.id, 1, 'posted', '')
    )
    const debit = await db.supplierEntry.findUniqueOrThrow({ where: { receiptId: receipt.id } })
    assert.equal(await balance(debit.id), '1150.00')
    const allocate = () =>
      apply({ op: 'allocate', credit, targets: [{ id: debit.id, amount: '300' }], date })
    const attempts = await Promise.allSettled([allocate(), allocate()])
    assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1)
    assert.equal(await balance(credit), '0.00')
    assert.equal(await balance(debit.id), '850.00')
    await pay('500', debit.id)
    assert.equal(await balance(debit.id), '350.00')
    assert.equal((await db.inventoryPart.findUniqueOrThrow({ where: { id: part.id } })).quantity, 8)
    if (demo) {
      preserve = true
      console.log('Manual example: /settlements?supplier=' + supplier.id + '&receipt=' + receipt.id)
      return
    }
    await assert.rejects(
      db.$transaction((tx) =>
        applyOperation(
          tx,
          'wrong-org',
          supplier.id,
          userId,
          randomUUID(),
          operation.parse({
            op: 'payment',
            amount: '1',
            method: 'cash',
            reference: '',
            note: '',
            date,
          })
        )
      )
    )
    await assert.rejects(
      apply({
        op: 'payment',
        amount: '1',
        target: debit.id,
        expectedOpen: '1150',
        method: 'cash',
        reference: '',
        note: '',
        date,
      })
    )
    await apply({ op: 'due', entry: debit.id, due: '2026-11-21' })
    assert.equal(await db.supplierTermChange.count({ where: { entryId: debit.id } }), 1)
    const opening = randomUUID()
    await apply(
      { op: 'opening', kind: 'opening_debt', amount: '20', note: 'звірка', date },
      opening
    )
    await assert.rejects(
      apply({ op: 'opening', kind: 'opening_credit', amount: '20', note: 'повтор', date })
    )
    const pool = randomUUID()
    await pay('100', undefined, pool)
    await assert.rejects(
      apply({
        op: 'allocate',
        credit: pool,
        date,
        targets: [
          { id: debit.id, amount: '50' },
          { id: opening, amount: '21' },
        ],
      })
    )
    assert.equal(await balance(pool), '100.00')
    await apply({
      op: 'allocate',
      credit: pool,
      date,
      targets: [
        { id: debit.id, amount: '80' },
        { id: opening, amount: '20' },
      ],
    })
    assert.equal(await balance(opening), '0.00')
    assert.equal(await balance(debit.id), '270.00')
    const transfer = randomUUID()
    await pay('269.99', debit.id, transfer)
    assert.equal(await balance(debit.id), '0.01')
    const excess = randomUUID()
    await pay('1', debit.id, excess)
    assert.equal(await balance(debit.id), '0.00')
    assert.equal(await balance(excess), '0.99')
    await apply({ op: 'reverse', kind: 'entry', id: excess, reason: 'повернення тесту' })
    assert.equal(await balance(debit.id), '0.01')
    await pay('0.01', debit.id)
    assert.equal(await balance(debit.id), '0.00')
    await db.inventoryPart.update({ where: { id: part.id }, data: { quantity: 1 } })
    await assert.rejects(
      db.$transaction((tx) =>
        transitionReceipt(tx, organizationId, userId, receipt.id, 2, 'cancelled', 'тест')
      )
    )
    assert.equal(await balance(transfer), '0.00')
    await db.inventoryPart.update({ where: { id: part.id }, data: { quantity: 8 } })
    await db.$transaction((tx) =>
      transitionReceipt(tx, organizationId, userId, receipt.id, 2, 'cancelled', 'тест')
    )
    assert.equal(await balance(transfer), '269.99')
    assert.equal((await db.inventoryPart.findUniqueOrThrow({ where: { id: part.id } })).quantity, 3)
    console.log(
      'PASS: payment retries, concurrent allocation, 300 + 500 payment scenario, split allocation rollback, opening balance, last kopeck, overpayment, payment reversal, stock reversal.'
    )
  } finally {
    if (!preserve)
      await db.$transaction(async (tx) => {
        await tx.supplierEntry.deleteMany({ where: scope })
        await tx.stockMovement.deleteMany({ where: { organizationId, inventoryPartId: part.id } })
        await tx.supplierReceipt.delete({ where: { id: receipt.id } })
        await tx.inventoryPart.delete({ where: { id: part.id } })
        await tx.counterparty.delete({ where: { id: supplier.id } })
      })
  }
}
check()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
