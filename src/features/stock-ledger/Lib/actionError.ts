import { ZodError } from 'zod'
import { isInternalError } from '@/lib/public-error-message'
export function ledgerActionError(error: unknown) {
  if (error instanceof ZodError)
    return {
      code: 'VALIDATION' as const,
      fields: error.issues.map((issue) => ({
        field: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    }
  if (isInternalError(error)) return { code: 'INTERNAL' as const, fields: [] }
  return { code: 'OPERATION_REJECTED' as const, fields: [] }
}
