import { randomUUID } from 'node:crypto'
import { withAuth as authenticated, type AuthContext } from '@/lib/with-auth'
import { ledgerActionError } from './actionError'
/** Preserve the app's authentication contract while making failures traceable and field-addressable. */
export async function withLedgerAuth<T>(
  action: (ctx: AuthContext) => Promise<T>,
  options?: Parameters<typeof authenticated<T>>[1]
) {
  let detail: ReturnType<typeof ledgerActionError> | undefined
  const result = await authenticated(async (ctx) => {
    try {
      return await action(ctx)
    } catch (error) {
      detail = ledgerActionError(error)
      throw error
    }
  }, options)
  if (result.success) return result
  const requestId = randomUUID(),
    code = detail?.code ?? (result.forbidden ? 'FORBIDDEN' : 'AUTH_REQUIRED')
  console.error('[ledger-action]', requestId, code)
  return { ...result, code, requestId, fields: detail?.fields ?? [] }
}
