import 'server-only'
import { getLocale } from 'next-intl/server'
import { operationText } from './operations'

export async function getOperationText() {
  try {
    return operationText(await getLocale())
  } catch {
    // Background jobs and isolated domain tests have no request locale.
    return (text: string | null | undefined) => text ?? ''
  }
}
