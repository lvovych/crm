import { getCachedMembership } from '@/lib/cached-session'
import { PermissionSubject, hasPermission, type PermissionInput } from '@/lib/permissions'
import type { AuthContext } from '@/lib/with-auth'

export async function staffCan(ctx: AuthContext, permission: PermissionInput) {
  if (permission.subject === PermissionSubject.PAYROLL) return ctx.isOrganizationOwner === true
  if (ctx.isAdmin) return true
  const membership = await getCachedMembership(ctx.userId)
  return (
    membership?.organizationId === ctx.organizationId &&
    hasPermission(membership.customRole?.permissions || [], permission)
  )
}
