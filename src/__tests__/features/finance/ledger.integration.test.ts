// @vitest-environment node
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { postMoney, financeActive, fingerprint } from '@/features/finance/ledger'
import type { TxClient } from '@/lib/db'
const url = process.env.FINANCE_TEST_DATABASE_URL
const suite = url ? describe : describe.skip
suite('cash ledger on real PostgreSQL', () => {
  let db: PrismaClient
  let org: string, entity: string, cash: string, bank: string, other: string, category: string
  beforeAll(async () => {
    if (
      !url ||
      !['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
      !new URL(url).pathname.includes('test')
    )
      throw new Error('Only a dedicated local test database is allowed')
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
    org = (await db.organization.create({ data: { name: `Finance integration ${randomUUID()}` } }))
      .id
    entity = (
      await db.ownLegalEntity.create({ data: { organizationId: org, name: 'Test company' } })
    ).id
    cash = (
      await db.moneyAccount.create({
        data: { organizationId: org, legalEntityId: entity, name: 'Cash', kind: 'cash' },
      })
    ).id
    bank = (
      await db.moneyAccount.create({
        data: { organizationId: org, legalEntityId: entity, name: 'Bank', kind: 'bank' },
      })
    ).id
    const foreign = await db.organization.create({ data: { name: 'Foreign test' } })
    const foreignEntity = await db.ownLegalEntity.create({
      data: { organizationId: foreign.id, name: 'Foreign' },
    })
    other = (
      await db.moneyAccount.create({
        data: {
          organizationId: foreign.id,
          legalEntityId: foreignEntity.id,
          name: 'Foreign cash',
          kind: 'cash',
        },
      })
    ).id
    category = (
      await db.cashFlowCategory.create({
        data: { organizationId: org, name: 'Rent', direction: 'expense' },
      })
    ).id
    await db.financeSettings.create({
      data: { organizationId: org, activatedOn: new Date('2026-01-01'), activatedAt: new Date() },
    })
  })
  afterAll(async () => {
    await db?.$disconnect()
  })
  const post = (data: Parameters<typeof postMoney>[3], opening = false) =>
    db.$transaction((tx) =>
      postMoney(tx as unknown as TxClient, org, 'test-actor', data, { opening })
    )
  const balance = async (id: string) =>
    Number(
      (
        await db.moneyEntry.aggregate({
          where: { organizationId: org, accountId: id },
          _sum: { amount: true },
        })
      )._sum.amount ?? 0
    )
  it('creates an opening exactly once and rejects a changed replay', async () => {
    const input = {
      requestId: randomUUID(),
      kind: 'opening',
      date: '2026-01-01',
      amount: '100.00',
      targetAccountId: cash,
      note: 'Opening',
    }
    const a = await post(input, true),
      b = await post(input, true)
    expect(a.id).toBe(b.id)
    expect(await balance(cash)).toBe(100)
    await expect(post({ ...input, amount: '101.00' }, true)).rejects.toThrow('іншими даними')
  })
  it('transfers atomically and preserves the total', async () => {
    await post({
      requestId: randomUUID(),
      kind: 'transfer',
      date: '2026-01-02',
      amount: '30.00',
      sourceAccountId: cash,
      targetAccountId: bank,
      note: 'Transfer',
    })
    expect(await balance(cash)).toBe(70)
    expect(await balance(bank)).toBe(30)
  })
  it('rolls back both document and entries when a later operation fails', async () => {
    const requestId = randomUUID()
    await expect(
      db.$transaction(async (tx) => {
        await postMoney(tx as unknown as TxClient, org, 'actor', {
          requestId,
          kind: 'transfer',
          date: '2026-01-03',
          amount: '10.00',
          sourceAccountId: cash,
          targetAccountId: bank,
          note: 'Rollback',
        })
        throw new Error('fail after posting')
      })
    ).rejects.toThrow('fail after posting')
    expect(await db.financialDocument.count({ where: { organizationId: org, requestId } })).toBe(0)
    expect(await balance(cash)).toBe(70)
  })
  it('serializes competing withdrawals instead of overdrawing', async () => {
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        post({
          requestId: randomUUID(),
          kind: 'expense',
          date: '2026-01-04',
          amount: '50.00',
          sourceAccountId: cash,
          categoryId: category,
          note: 'Concurrent',
        })
      )
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await balance(cash)).toBe(20)
  })
  it('rejects a foreign account without writing a document', async () => {
    const requestId = randomUUID()
    await expect(
      post({
        requestId,
        kind: 'transfer',
        date: '2026-01-05',
        amount: '1.00',
        sourceAccountId: cash,
        targetAccountId: other,
        note: 'Foreign',
      })
    ).rejects.toThrow('недоступний')
    expect(await db.financialDocument.count({ where: { requestId, organizationId: org } })).toBe(0)
  })
  it('checks future historical boundaries for a backdated withdrawal', async () => {
    await post(
      {
        requestId: randomUUID(),
        kind: 'opening',
        date: '2026-01-10',
        amount: '100.00',
        targetAccountId: cash,
        note: 'Boundary fixture',
      },
      true
    )
    await expect(
      post({
        requestId: randomUUID(),
        kind: 'expense',
        date: '2026-01-03',
        amount: '30.00',
        sourceAccountId: cash,
        categoryId: category,
        note: 'Backdated',
      })
    ).rejects.toThrow('Недостатньо')
  })
  it('database prevents editing and deleting a posted entry', async () => {
    const entry = await db.moneyEntry.findFirstOrThrow({ where: { organizationId: org } })
    await expect(
      db.moneyEntry.update({ where: { id: entry.id }, data: { amount: '0.00' } })
    ).rejects.toThrow('immutable')
    await expect(db.moneyEntry.delete({ where: { id: entry.id } })).rejects.toThrow('immutable')
  })
  it('database prevents rewriting a posted financial document', async () => {
    const doc = await db.financialDocument.findFirstOrThrow({ where: { organizationId: org } })
    await expect(
      db.financialDocument.update({ where: { id: doc.id }, data: { amount: '999.00' } })
    ).rejects.toThrow('immutable')
  })
  it('rejects dates before activation and closed dates', async () => {
    const input = {
      requestId: randomUUID(),
      kind: 'transfer',
      date: '2025-12-31',
      amount: '1.00',
      sourceAccountId: cash,
      targetAccountId: bank,
      note: 'Date check',
    }
    await expect(post(input)).rejects.toThrow('раніше')
    await db.financeSettings.update({
      where: { organizationId: org },
      data: { closedThrough: new Date('2026-01-05') },
    })
    await expect(post({ ...input, date: '2026-01-05' })).rejects.toThrow('закритий')
  })
  it('activation survives removal of the rollout environment flag', async () => {
    const before = process.env.FINANCE_ORGANIZATIONS
    delete process.env.FINANCE_ORGANIZATIONS
    try {
      expect(await financeActive(db as unknown as TxClient, org)).toBe(true)
    } finally {
      if (before !== undefined) process.env.FINANCE_ORGANIZATIONS = before
    }
  })
  it('drafts do not affect balances and posting twice creates one movement', async () => {
    const input = {
      requestId: randomUUID(),
      kind: 'transfer',
      date: '2026-01-12',
      amount: '0.01',
      sourceAccountId: cash,
      targetAccountId: bank,
      note: 'Draft',
    }
    const before = await balance(cash)
    const draft = await db.financialDocument.create({
      data: {
        ...input,
        date: new Date(input.date),
        organizationId: org,
        fingerprint: fingerprint(input),
        createdById: 'actor',
        status: 'draft',
      },
    })
    expect(await balance(cash)).toBe(before)
    const posted = await post(input)
    expect(posted.id).toBe(draft.id)
    expect(posted.status).toBe('posted')
    await post(input)
    expect(await db.moneyEntry.count({ where: { documentId: draft.id } })).toBe(2)
    expect(await balance(cash)).toBeCloseTo(before - 0.01, 2)
  })
  it.each([
    '0.00',
    '-1.00',
    '0.001',
    '1e3',
  ])('rejects invalid amount %s without any entries', async (amount) => {
    const requestId = randomUUID()
    await expect(
      post({
        requestId,
        kind: 'transfer',
        date: '2026-01-12',
        amount,
        sourceAccountId: cash,
        targetAccountId: bank,
        note: 'Invalid',
      })
    ).rejects.toThrow()
    expect(await db.financialDocument.count({ where: { requestId } })).toBe(0)
  })
  it('rejects missing transfer destination and self transfers', async () => {
    const input = {
      requestId: randomUUID(),
      kind: 'transfer',
      date: '2026-01-12',
      amount: '1.00',
      sourceAccountId: cash,
      note: 'Shape',
    }
    await expect(post(input)).rejects.toThrow('типу')
    await expect(post({ ...input, targetAccountId: cash })).rejects.toThrow('різні')
  })
  it('rejects a foreign payment link even when the account is local', async () => {
    await expect(
      post({
        requestId: randomUUID(),
        kind: 'customer_payment',
        date: '2026-01-12',
        amount: '1.00',
        targetAccountId: cash,
        paymentId: 'missing-payment',
        note: 'Foreign payment',
      })
    ).rejects.toThrow('Оплата недоступна')
  })
  it('rejects an archived account and restores availability after reopening', async () => {
    await db.moneyAccount.update({ where: { id: bank }, data: { isArchived: true } })
    try {
      await expect(
        post({
          requestId: randomUUID(),
          kind: 'transfer',
          date: '2026-01-12',
          amount: '1.00',
          sourceAccountId: cash,
          targetAccountId: bank,
          note: 'Archived',
        })
      ).rejects.toThrow('недоступний')
    } finally {
      await db.moneyAccount.update({ where: { id: bank }, data: { isArchived: false } })
    }
  })
  it('rejects an expense category on an incoming operation', async () => {
    await expect(
      post({
        requestId: randomUUID(),
        kind: 'income',
        date: '2026-01-12',
        amount: '1.00',
        targetAccountId: cash,
        categoryId: category,
        note: 'Direction',
      })
    ).rejects.toThrow('Стаття')
  })
  it('prevents inter-company transfers within the same organization', async () => {
    const own = await db.ownLegalEntity.create({
      data: { organizationId: org, name: 'Another legal entity' },
    })
    const account = await db.moneyAccount.create({
      data: { organizationId: org, legalEntityId: own.id, name: 'Second company', kind: 'bank' },
    })
    await expect(
      post({
        requestId: randomUUID(),
        kind: 'transfer',
        date: '2026-01-12',
        amount: '1.00',
        sourceAccountId: cash,
        targetAccountId: account.id,
        note: 'Company boundary',
      })
    ).rejects.toThrow('однієї')
  })
  it('rolls back the work order payment together with a failed cash posting', async () => {
    const record = await db.serviceRecord.create({
      data: { organizationId: org, title: 'Payment atomicity' },
    })
    await expect(
      db.$transaction(async (tx) => {
        const p = await tx.payment.create({
          data: { serviceRecordId: record.id, amount: 10.01, amountExact: '10.01', method: 'cash' },
        })
        await postMoney(tx as unknown as TxClient, org, 'actor', {
          requestId: randomUUID(),
          kind: 'customer_payment',
          date: '2026-01-12',
          amount: '10.01',
          targetAccountId: other,
          paymentId: p.id,
          note: 'Atomic payment',
        })
      })
    ).rejects.toThrow('недоступний')
    expect(await db.payment.count({ where: { serviceRecordId: record.id } })).toBe(0)
  })
  it('freezes the linked payment and preserves exact cents in invoice totals', async () => {
    const record = await db.serviceRecord.create({
      data: { organizationId: org, title: 'Linked payment' },
    })
    const p = await db.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: { serviceRecordId: record.id, amount: 10.01, amountExact: '10.01', method: 'cash' },
      })
      await postMoney(tx as unknown as TxClient, org, 'actor', {
        requestId: randomUUID(),
        kind: 'customer_payment',
        date: '2026-01-12',
        amount: '10.01',
        targetAccountId: cash,
        paymentId: payment.id,
        note: 'Linked payment',
      })
      return payment
    })
    expect(p.amountExact?.toFixed(2)).toBe('10.01')
    await expect(db.payment.update({ where: { id: p.id }, data: { amount: 1 } })).rejects.toThrow(
      'immutable'
    )
    await expect(db.payment.delete({ where: { id: p.id } })).rejects.toThrow('immutable')
  })
})
