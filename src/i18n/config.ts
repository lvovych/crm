export const locales = ['uk', 'ru', 'en'] as const

export type Locale = (typeof locales)[number]
export const defaultLocale: Locale = 'uk'
export const localeNames: Record<Locale, string> = {
  uk: 'Українська',
  ru: 'Русский',
  en: 'English',
}

export function supportedLocale(value: string | null | undefined): Locale {
  return locales.includes(value as Locale) ? (value as Locale) : defaultLocale
}
