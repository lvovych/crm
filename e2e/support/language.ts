/** A signed-out browser with an explicit UI language, independent of app defaults. */
export function languageState(language: 'en' | 'uk' | 'ru' = 'en') {
  const url = new URL(process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3100')
  return {
    cookies: [
      {
        name: 'locale',
        value: language,
        domain: url.hostname,
        path: '/',
        expires: -1,
        httpOnly: false,
        secure: url.protocol === 'https:',
        sameSite: 'Lax' as const,
      },
    ],
    origins: [],
  }
}
