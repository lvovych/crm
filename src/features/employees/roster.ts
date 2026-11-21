export const rosterUser = {
  select: {
    name: true,
    organizationMembers: {
      select: { organizationId: true, role: true, customRole: { select: { name: true } } },
    },
  },
} as const
/** A linked CRM account is the visible identity; old imported cards remain separate. */
export function rosterIdentity(person: {
  name: string
  workRoles: string[]
  organizationId: string
  user?: {
    name: string
    organizationMembers: {
      organizationId: string
      role: string
      customRole: { name: string } | null
    }[]
  } | null
}) {
  const member = person.user?.organizationMembers.find(
    (m) => m.organizationId === person.organizationId
  )
  const crmRole = member?.role === 'owner' ? 'Власник' : (member?.customRole?.name ?? null)
  const defaultRole = person.workRoles.length === 1 && person.workRoles[0] === 'mechanic'
  const workRoles =
    defaultRole && crmRole && ['manager', 'менеджер'].includes(crmRole.toLowerCase())
      ? ['advisor']
      : defaultRole && member?.role === 'owner'
        ? ['owner']
        : person.workRoles
  return { name: person.user?.name || person.name, workRoles, crmRole }
}
