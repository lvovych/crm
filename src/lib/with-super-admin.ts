import { getOperationText } from '@/i18n/operation-text.server'
import { getCachedSession } from './cached-session'
import { db } from './db'
import type { ActionResult } from './with-auth'
import { publicErrorMessage } from '@/lib/public-error-message'

type SuperAdminContext = {
  userId: string
}

export async function withSuperAdmin<T>(
  action: (ctx: SuperAdminContext) => Promise<T>
): Promise<ActionResult<T>> {
  const translateError = await getOperationText()
  try {
    const session = await getCachedSession()

    if (!session?.user?.id) {
      return { success: false, error: translateError('Unauthorized') }
    }

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { isSuperAdmin: true },
    })

    if (!user?.isSuperAdmin) {
      return { success: false, error: translateError('Forbidden') }
    }

    const data = await action({ userId: session.user.id })
    return { success: true, data }
  } catch (error) {
    // See withAuth: logged in full, shown only when it is the action's own.
    console.error('[withSuperAdmin] Error:', error)
    return { success: false, error: translateError(publicErrorMessage(error)) }
  }
}
