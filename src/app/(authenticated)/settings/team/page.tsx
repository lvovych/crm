import { memberLinks, linkEmployee } from '@/features/employees/actions'
import { getOrganization } from '@/features/team/Actions/teamActions'
import { getRoles } from '@/features/team/Actions/getRoles'
import { getPendingInvitations } from '@/features/team/Actions/getPendingInvitations'
import { getTechnicianUserIds } from '@/features/team/Actions/setMemberTechnician'
import { getWorkshopDialCode } from '@/features/team/Actions/createTechnicianAccount'
import { getStandaloneTechnicians } from '@/features/team/Actions/giveTechnicianTheApp'
import { TeamSettings } from './team-settings'

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ add?: string }>
}) {
  // Quick Add sends people here to add somebody, so land them on the question
  // rather than on a page where they have to find the button again.
  const { add } = await searchParams
  const [result, rolesResult, invitationsResult, technicianResult, dialResult, standaloneResult] =
    await Promise.all([
      getOrganization(),
      getRoles(),
      getPendingInvitations(),
      getTechnicianUserIds(),
      getWorkshopDialCode(),
      getStandaloneTechnicians(),
    ])
  const orgData = result.success ? result.data : null
  const roles = rolesResult.success && rolesResult.data ? rolesResult.data : []
  const pendingInvitations =
    invitationsResult.success && invitationsResult.data ? invitationsResult.data : []
  const technicianUserIds =
    technicianResult.success && technicianResult.data ? technicianResult.data : []

  const links = (await memberLinks()).data
  return (
    <>
      <TeamSettings
        organization={orgData?.organization || null}
        currentRole={orgData?.currentRole || null}
        roles={roles}
        pendingInvitations={pendingInvitations}
        technicianUserIds={technicianUserIds}
        startAdding={add === 'true'}
        dialCode={(dialResult.success && dialResult.data?.dialCode) || ''}
        standaloneTechnicians={
          standaloneResult.success && standaloneResult.data ? standaloneResult.data : []
        }
      />
      {links && (
        <section className="m-6 space-y-3">
          <h2 className="text-xl font-semibold">Прив’язка користувачів до працівників</h2>
          {links.members.map(({ user }) => (
            <form key={user.id} action={linkEmployee} className="flex items-center gap-3">
              <input type="hidden" name="userId" value={user.id} />
              <label>
                {user.name || user.email}{' '}
                <select
                  name="employee"
                  defaultValue={links.employees.find((e) => e.userId === user.id)?.id || ''}
                >
                  <option value="">Без прив’язки</option>
                  {links.employees
                    .filter((e) => !e.userId || e.userId === user.id)
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                </select>
              </label>
              <button>Зберегти</button>
            </form>
          ))}
        </section>
      )}
    </>
  )
}
