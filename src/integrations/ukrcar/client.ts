import { load } from 'cheerio'
import { ORIGIN, TRANSACTIONS, assertAuthenticated } from './parser'

/** Cookies live only for this run. Never persist sessions or include response HTML in errors. */
export class UkrcarClient {
  private cookies = new Map<string, string>()
  constructor(private fetcher: (url: string, init?: RequestInit) => Promise<Response> = fetch) {}

  async request(path: string, init: RequestInit = {}): Promise<string> {
    let url = new URL(path, ORIGIN)
    let options = init
    for (let redirect = 0; redirect < 5; redirect++) {
      if (
        url.origin !== ORIGIN ||
        url.username ||
        url.password ||
        !/^\/uk\/(users\/login\/|accounting\/transactions\/)/.test(url.pathname)
      ) {
        throw new Error('Укркар: неочікувана адреса відповіді.')
      }
      const headers = new Headers(options.headers)
      headers.set('Cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '))
      let response: Response
      try {
        response = await this.fetcher(url.href, {
          ...options,
          headers,
          redirect: 'manual',
          cache: 'no-store',
          signal: AbortSignal.timeout(25_000),
        })
      } catch {
        throw new Error('Укркар: сайт не відповідає. Імпорт буде повторено.')
      }
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';')[0]
        const at = pair.indexOf('=')
        if (at > 0) this.cookies.set(pair.slice(0, at), pair.slice(at + 1))
      }
      if ([301, 302, 303].includes(response.status)) {
        const location = response.headers.get('location')
        if (!location) throw new Error('Укркар: некоректне перенаправлення.')
        url = new URL(location, url)
        options = {}
        await response.body?.cancel()
        continue
      }
      if (!response.ok) throw new Error(`Укркар: сайт повернув HTTP ${response.status}.`)
      const html = await response.text()
      if (html.length > 5_000_000) throw new Error('Укркар: відповідь перевищує допустимий розмір.')
      return html
    }
    throw new Error('Укркар: забагато перенаправлень.')
  }

  async login(credentials: Record<string, unknown>) {
    if (typeof credentials.username !== 'string' || typeof credentials.password !== 'string')
      throw new Error('Укркар: вкажіть логін і пароль.')
    const path = `/uk/users/login/?next=${TRANSACTIONS}`
    const html = await this.request(path)
    const token = load(html)('input[name="csrfmiddlewaretoken"]').attr('value')
    if (!token) throw new Error('Укркар: форма входу змінилася.')
    const result = await this.request(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: `${ORIGIN}${path}`,
        Origin: ORIGIN,
      },
      body: new URLSearchParams({
        username: credentials.username,
        password: credentials.password,
        csrfmiddlewaretoken: token,
      }).toString(),
    })
    assertAuthenticated(result)
    return result
  }
}
