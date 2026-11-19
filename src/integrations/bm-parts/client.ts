import { z } from 'zod'

export const API_ORIGIN = 'https://api.bm.parts'
export const PAGE_SIZE = 30
const pageSchema = z.object({ documents: z.array(z.unknown()).max(100).nullable() })

export class BmPartsClient {
  private readonly key: string
  constructor(
    credentials: Record<string, unknown>,
    private readonly fetcher: (url: string, init?: RequestInit) => Promise<Response> = fetch
  ) {
    this.key = z.string().trim().min(1).max(1000).parse(credentials.apiKey)
  }

  async sales(period: { from: string; to: string }, page: number): Promise<unknown[]> {
    const url = new URL('/documents/sales_with_products', API_ORIGIN)
    url.search = new URLSearchParams({
      period: `{${period.from},${period.to}}`,
      page: String(page),
      per_page: String(PAGE_SIZE),
      direction: 'asc',
      edo_signed: 'all',
    }).toString()
    let response: Response
    try {
      response = await this.fetcher(url.href, {
        method: 'GET',
        headers: {
          Authorization: this.key,
          'User-Agent': 'LautoCRM/1.0',
          Accept: 'application/json',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(25_000),
      })
    } catch {
      throw new Error('Бус Маркет: не вдалося отримати відповідь API. Спробуйте пізніше.')
    }
    if (!response.ok) {
      if ([401, 403].includes(response.status))
        throw new Error('Бус Маркет: перевірте API-ключ і доступ до накладних.')
      throw new Error(`Бус Маркет: API повернув HTTP ${response.status}. Спробуйте пізніше.`)
    }
    // Bound memory even when Content-Length is absent or incorrect.
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Бус Маркет: порожня відповідь API.')
    const chunks: Uint8Array[] = []
    let bytes = 0
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > 5_000_000) throw new Error('Бус Маркет: відповідь API перевищує ліміт.')
        chunks.push(value)
      }
    } finally {
      await reader.cancel()
    }
    try {
      return pageSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))).documents ?? []
    } catch {
      throw new Error('Бус Маркет: некоректний формат списку накладних.')
    }
  }
}
