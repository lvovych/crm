import { it, expect } from 'vitest'
import { paymentRolesMissingCashAccess } from '@/features/finance/readiness'
import { PermissionAction as A, PermissionSubject as S } from '@/lib/permissions'
const member = {
  name: 'Manager',
  administrator: false,
  roleId: 'manager',
  permissions: [{ action: A.CREATE, subject: S.BILLING }],
}
it('blocks activation when a current cashier has no finance permissions', () =>
  expect(paymentRolesMissingCashAccess([member], new Set(['manager']))).toEqual(['Manager']))
it('blocks activation when a cashier can post but has no account access', () =>
  expect(
    paymentRolesMissingCashAccess(
      [
        {
          ...member,
          permissions: [...member.permissions, { action: A.UPDATE, subject: S.FINANCE }],
        },
      ],
      new Set()
    )
  ).toEqual(['Manager']))
it('allows a cashier with posting and account access', () =>
  expect(
    paymentRolesMissingCashAccess(
      [
        {
          ...member,
          permissions: [...member.permissions, { action: A.UPDATE, subject: S.FINANCE }],
        },
      ],
      new Set(['manager'])
    )
  ).toEqual([]))
it('does not require ACL rows for administrators', () =>
  expect(paymentRolesMissingCashAccess([{ ...member, administrator: true }], new Set())).toEqual(
    []
  ))
it('does not demand posting rights from staff who never handle payments', () =>
  expect(
    paymentRolesMissingCashAccess(
      [{ ...member, permissions: [{ action: A.READ, subject: S.BILLING }] }],
      new Set()
    )
  ).toEqual([]))
it('checks supplier payment staff as well', () =>
  expect(
    paymentRolesMissingCashAccess(
      [{ ...member, permissions: [{ action: A.CREATE, subject: S.SETTLEMENTS }] }],
      new Set()
    )
  ).toEqual(['Manager']))
