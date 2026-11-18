'use server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, type AuthContext } from '@/lib/with-auth'
import { getCachedMembership } from '@/lib/cached-session'
import { PermissionAction as A, PermissionSubject as S, hasPermission } from '@/lib/permissions'
import { accessibleAccounts } from '@/features/finance/access'
import { receiptsEnabled } from '@/features/receipts/enabled'
import { settlementsEnabled } from '@/features/settlements/ledger'
import { readJournal, readDocument } from './queries'
import { documentTypes, type DocumentScope, type DocumentType } from './types'

async function scopeFor(ctx: AuthContext): Promise<DocumentScope> {
  const member = await getCachedMembership(ctx.userId)
  const can = (subject: S) =>
    ctx.isAdmin ||
    (member?.organizationId === ctx.organizationId &&
      hasPermission(member.customRole?.permissions ?? [], { action: A.READ, subject }))
  const finance = can(S.FINANCE)
  return {
    organizationId: ctx.organizationId,
    receipts: can(S.RECEIPTS) && receiptsEnabled(ctx.organizationId),
    orders: can(S.SERVICES),
    settlements: can(S.SETTLEMENTS) && settlementsEnabled(ctx.organizationId),
    finance,
    payroll: ctx.isOrganizationOwner === true,
    accounts: finance ? (await accessibleAccounts(ctx)).map((a) => a.id) : [],
  }
}
function availableTypes(s: DocumentScope): DocumentType[] {
  return [
    ...(s.receipts ? (['receipt', 'return'] as const) : []),
    ...(s.orders ? (['order', 'payment'] as const) : []),
    ...(s.finance ? (['finance'] as const) : []),
    ...(s.settlements ? (['supplier'] as const) : []),
    ...(s.payroll ? (['salary'] as const) : []),
  ]
}
export async function documentJournal(raw: unknown) {
  return withAuth(async (ctx) => {
    const scope = await scopeFor(ctx),
      types = availableTypes(scope)
    if (!types.length) throw new Error('Немає доступу до журналу документів.')
    return { ...(await readJournal(db, scope, raw)), types }
  })
}
export async function documentDetail(type: string, id: string) {
  return withAuth(async (ctx) => {
    if (!Object.hasOwn(documentTypes, type)) return null
    z.string().min(1).max(128).parse(id)
    return readDocument(db, await scopeFor(ctx), type + ':' + id)
  })
}
