import { useLocale } from 'next-intl'
import { operationText } from './operations'

export function useOperationText() {
  return operationText(useLocale())
}
