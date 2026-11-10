import { getCachedMembership } from '@/lib/cached-session'
import { db, type TxClient } from '@/lib/db'
import type { AuthContext } from '@/lib/with-auth'
import { hasPermission, PermissionAction as A, PermissionSubject as S } from '@/lib/permissions'
import { workshopTimeZone } from '@/lib/workshop-timezone'
import { zonedDayKey } from '@/lib/timezone'

export async function financeCapabilities(ctx: AuthContext) {
  const member = ctx.isAdmin ? null : await getCachedMembership(ctx.userId)
  const allows = (action: A, subject = S.FINANCE) =>
    ctx.isAdmin ||
    (member?.organizationId === ctx.organizationId &&
      hasPermission(member.customRole?.permissions ?? [], { action, subject }))
  return {
    manage: allows(A.MANAGE),
    manageAccounts: allows(A.MANAGE, S.FINANCE_ACCOUNTS),
    post: allows(A.UPDATE),
    draft: allows(A.CREATE),
    reverse: allows(A.DELETE),
    transfer: allows(A.CREATE, S.FINANCE_TRANSFER),
  }
}
export async function assertFinancePermission(ctx: AuthContext, action: A, subject = S.FINANCE) {
  if (ctx.isAdmin) return
  const member = await getCachedMembership(ctx.userId)
  if (
    member?.organizationId !== ctx.organizationId ||
    !hasPermission(member.customRole?.permissions ?? [], { action, subject })
  )
    throw new Error('Недостатньо прав для фінансової операції.')
}
export async function accessibleAccounts(ctx: AuthContext, post = false, tx: TxClient = db) {
  const member = ctx.isAdmin ? null : await getCachedMembership(ctx.userId)
  return tx.moneyAccount.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(!ctx.isAdmin
        ? {
            access: {
              some: {
                roleId: member?.roleId ?? '',
                ...(post ? { canPost: true } : { canRead: true }),
              },
            },
          }
        : {}),
    },
    include: { legalEntity: { select: { name: true } } },
    orderBy: { name: 'asc' },
  })
}
export async function assertAccountAccess(
  ctx: AuthContext,
  ids: (string | undefined)[],
  tx: TxClient = db
) {
  const accounts = await accessibleAccounts(ctx, true, tx)
  if (ids.filter(Boolean).some((id) => !accounts.some((a) => a.id === id && !a.isArchived)))
    throw new Error('Немає доступу до вибраної каси.')
}
export async function assertOperationDate(ctx: AuthContext, date: string) {
  const today = zonedDayKey(new Date(), await workshopTimeZone(ctx.organizationId))
  if (date > today) throw new Error('Не можна проводити майбутню операцію.')
  if (date < today) await assertFinancePermission(ctx, A.CREATE, S.FINANCE_BACKDATE)
}
