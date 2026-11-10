import {
  hasPermission,
  PermissionAction as A,
  PermissionSubject as S,
  type PermissionInput,
} from '@/lib/permissions'
/** Activation must not strand staff who could previously record payments. */
export function paymentRolesMissingCashAccess(
  members: readonly {
    name: string
    administrator: boolean
    roleId: string | null
    permissions: PermissionInput[]
  }[],
  postRoleIds: ReadonlySet<string>
): string[] {
  return members
    .filter(
      (m) =>
        !m.administrator &&
        (hasPermission(m.permissions, { action: A.CREATE, subject: S.BILLING }) ||
          hasPermission(m.permissions, { action: A.CREATE, subject: S.SETTLEMENTS })) &&
        (!hasPermission(m.permissions, { action: A.UPDATE, subject: S.FINANCE }) ||
          !m.roleId ||
          !postRoleIds.has(m.roleId))
    )
    .map((m) => m.name)
}
