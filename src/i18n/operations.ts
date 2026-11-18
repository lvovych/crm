import uk from '../../messages/uk/operations.json'
import en from '../../messages/en/operations.json'
import ru from '../../messages/ru/operations.json'
import { supportedLocale } from './config'

const keys = new Map<string, string>()
for (const [key, text] of Object.entries(uk)) if (!keys.has(text)) keys.set(text, key)
for (const [key, text] of Object.entries(en)) if (!keys.has(text)) keys.set(text, key)
const dictionaries: Record<string, Record<string, string>> = { uk, en, ru }

/** Translate application-owned labels only. Never pass customer-entered text here. */
export function operationText(locale: string) {
  const dictionary = dictionaries[supportedLocale(locale)]
  return (source: string | null | undefined): string => {
    if (source == null) return ''
    const normalized = source.trim().replace(/\s+/g, ' ')
    const key = keys.get(normalized)
    return key
      ? (source.match(/^\s*/)?.[0] ?? '') + dictionary[key] + (source.match(/\s*$/)?.[0] ?? '')
      : source
  }
}
