import { createHash } from 'node:crypto'
import type { TxClient } from '@/lib/db'
import { cents, decimal, assertHistoricalBalance } from './money'

export function fingerprint(value: unknown) {
  return createHash('sha256')
    .update(
      JSON.stringify(value, (_key, item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
          : item
      )
    )
    .digest('hex')
}
export function dateKey(date: Date) {
  return date.toISOString().slice(0, 10)
}
export async function lockFinance(tx: TxClient, org: string) {
  // Shared by activation and every financial write, including linked payments.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${org}), hashtext('finance'))`
}
export type Posting = {
  requestId: string
  kind: string
  date: string
  amount: string
  sourceAccountId?: string
  targetAccountId?: string
  categoryId?: string
  counterpartyLabel?: string
  note: string
  paymentId?: string
  supplierEntryId?: string
  reversalOfId?: string
  originalId?: string
}
export async function postMoney(
  tx: TxClient,
  org: string,
  actor: string,
  data: Posting,
  options: { opening?: boolean; pending?: boolean } = {}
) {
  await lockFinance(tx, org)
  const hash = fingerprint(data)
  const existing = await tx.financialDocument.findUnique({
    where: { organizationId_requestId: { organizationId: org, requestId: data.requestId } },
  })
  if (existing) {
    if (existing.fingerprint !== hash) throw new Error('Запит уже виконано з іншими даними.')
    if (existing.status !== 'draft') return existing
    await tx.financialDocument.delete({ where: { id: existing.id } })
  }
  const settings = await tx.financeSettings.findUnique({ where: { organizationId: org } })
  if (!options.opening && !settings?.activatedOn) throw new Error('Касовий облік ще не активовано.')
  const date = new Date(data.date + 'T00:00:00Z')
  if (settings?.activatedOn && date < settings.activatedOn)
    throw new Error('Дата раніше початку касового обліку. Потрібна звірка.')
  if (settings?.closedThrough && date <= settings.closedThrough) throw new Error('Період закритий.')
  const incoming = ['opening', 'income', 'customer_payment'].includes(data.kind)
  const outgoing = ['expense', 'supplier_payment'].includes(data.kind)
  if (
    (incoming && (!data.targetAccountId || data.sourceAccountId)) ||
    (outgoing && (!data.sourceAccountId || data.targetAccountId)) ||
    (data.kind === 'transfer' && (!data.sourceAccountId || !data.targetAccountId))
  )
    throw new Error('Рахунки не відповідають типу операції.')
  if (
    ![
      'opening',
      'income',
      'expense',
      'customer_payment',
      'supplier_payment',
      'transfer',
      'reversal',
      'refund',
    ].includes(data.kind)
  )
    throw new Error('Невідомий тип операції.')
  if ((data.kind === 'opening') !== !!options.opening)
    throw new Error('Неприпустимий початковий рух.')
  if (
    data.paymentId &&
    !(await tx.payment.findFirst({
      where: { id: data.paymentId, serviceRecord: { organizationId: org } },
    }))
  )
    throw new Error('Оплата недоступна.')
  if (
    data.supplierEntryId &&
    !(await tx.supplierEntry.findFirst({
      where: { id: data.supplierEntryId, organizationId: org },
    }))
  )
    throw new Error('Оплата постачальнику недоступна.')
  for (const id of [data.reversalOfId, data.originalId].filter(Boolean))
    if (
      !(await tx.financialDocument.findFirst({
        where: { id, organizationId: org, status: 'posted' },
      }))
    )
      throw new Error('Пов’язана операція недоступна.')
  const sum = cents(data.amount)
  if (sum <= BigInt('0') && !options.opening) throw new Error('Сума має бути додатною.')
  if (sum < BigInt('0') && options.opening)
    throw new Error('Початковий залишок не може бути від’ємним.')
  if (data.sourceAccountId && data.sourceAccountId === data.targetAccountId)
    throw new Error('Виберіть різні рахунки.')
  const ids = [data.sourceAccountId, data.targetAccountId].filter((id): id is string => !!id)
  const accounts = await tx.moneyAccount.findMany({
    where: { organizationId: org, id: { in: ids }, isArchived: false },
  })
  if (accounts.length !== ids.length || (!ids.length && !options.pending))
    throw new Error('Рахунок недоступний.')
  if (accounts.some((a) => a.currency !== 'UAH'))
    throw new Error('У цьому релізі підтримується лише гривня.')
  if (accounts.length === 2 && accounts[0].legalEntityId !== accounts[1].legalEntityId)
    throw new Error('Переказ можливий лише між рахунками однієї власної компанії.')
  if (data.categoryId) {
    const category = await tx.cashFlowCategory.findFirst({
      where: { id: data.categoryId, organizationId: org, isArchived: false },
    })
    if (
      !category ||
      (data.kind === 'income' && category.direction !== 'income') ||
      (data.kind === 'expense' && category.direction !== 'expense')
    )
      throw new Error('Стаття не відповідає операції.')
  }
  if (['income', 'expense'].includes(data.kind) && !data.categoryId)
    throw new Error('Оберіть статтю руху коштів.')
  if (data.sourceAccountId) {
    const account = accounts.find((a) => a.id === data.sourceAccountId)!
    if (!account.allowNegative) {
      const rows = await tx.moneyEntry.findMany({
        where: { organizationId: org, accountId: account.id },
        select: { date: true, amount: true },
      })
      assertHistoricalBalance(
        rows.map((r) => ({ date: dateKey(r.date), amount: r.amount.toFixed(2) })),
        data.date,
        -sum
      )
    }
  }
  const document = await tx.financialDocument.create({
    data: {
      ...data,
      ...(existing ? { id: existing.id, createdAt: existing.createdAt } : {}),
      organizationId: org,
      fingerprint: hash,
      date,
      amount: decimal(sum),
      createdById: existing?.createdById ?? actor,
      status: options.pending ? 'pending' : 'posted',
      postedById: options.pending ? null : actor,
      postedAt: options.pending ? null : new Date(),
    },
  })
  if (!options.pending) {
    for (const [id, amount] of [
      [data.sourceAccountId, -sum],
      [data.targetAccountId, sum],
    ] as const) {
      if (id)
        await tx.moneyEntry.create({
          data: {
            organizationId: org,
            documentId: document.id,
            accountId: id,
            date,
            amount: decimal(amount),
          },
        })
    }
  }
  return document
}
export async function financeActive(tx: TxClient, org: string) {
  return !!(await tx.financeSettings.findUnique({ where: { organizationId: org } }))?.activatedOn
}
