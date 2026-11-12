import { expect, it } from 'vitest'
import { ledgerWriteMetadata } from '@/features/customer-ledger/write-metadata'
const actor = { userId: 'u', name: 'Manager' }
it.each([
  'create',
  'update',
  'updateMany',
  'createMany',
  'createManyAndReturn',
  'updateManyAndReturn',
])('stamps actor for %s without changing business values', (operation) => {
  expect(ledgerWriteMetadata('Payment', operation, { data: { amount: 10 } }, actor)).toEqual({
    data: { amount: 10, ledgerActorId: 'u', ledgerActorName: 'Manager' },
  })
})
it('stamps arrays and both upsert branches and clears stale author in system writes', () => {
  expect(
    ledgerWriteMetadata('Payment', 'createMany', { data: [{ amount: 10 }, { amount: 20 }] }, actor)
  ).toMatchObject({
    data: [
      { amount: 10, ledgerActorId: 'u' },
      { amount: 20, ledgerActorId: 'u' },
    ],
  })
  expect(
    ledgerWriteMetadata('ServiceRecord', 'upsert', { create: {}, update: {} }, actor)
  ).toMatchObject({ create: { ledgerActorId: 'u' }, update: { ledgerActorId: 'u' } })
  expect(
    ledgerWriteMetadata(
      'Payment',
      'update',
      { data: { ledgerActorId: 'old' } },
      { userId: null, name: null }
    )
  ).toEqual({ data: { ledgerActorId: null, ledgerActorName: null } })
})
it('does not mutate reads, deletes or unrelated models', () => {
  const args = { where: { id: 'x' } }
  for (const [model, op] of [
    ['Payment', 'findMany'],
    ['Payment', 'delete'],
    ['Customer', 'update'],
  ])
    expect(ledgerWriteMetadata(model, op, args, actor)).toBe(args)
})
