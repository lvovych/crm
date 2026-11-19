// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { importPeriod, listUrl, parseList, parseReceipt } from '@/integrations/ukrcar/parser'
import { UkrcarClient } from '@/integrations/ukrcar/client'

const auth = '<a href="/uk/users/logout/">Вихід</a>'
const ref = {
  externalId: '234928',
  number: '9000388299',
  date: '2026-11-18',
  url: 'https://ukrcar.ua/uk/accounting/transactions/234928/',
}
const comment = 'Реализация товаров 9000388299 от 18.11.2026 14:33:54'
const detail = `${auth}<dl><dt>Коментар</dt><dd>${comment}</dd></dl><dl><dt>Сума</dt><dd>-1 234,50 грн.</dd></dl><table><tr><th>Виробник</th><th>Номер</th><th>Ім'я</th><th>К-ть</th><th>Ціна</th><th>Всього</th></tr><tr><td>ELRING</td><td>001.580</td><td>Прокладка &amp; комплект</td><td>2</td><td>617,25 грн.</td><td>1&nbsp;234,50 грн.</td></tr></table>`
const period = { from: '2026-11-06', to: '2026-11-19' }

describe('UkrCar documents', () => {
  it('uses 14 Kyiv calendar dates across UTC midnight, month and DST boundaries', () => {
    expect(importPeriod(new Date('2026-11-18T22:30:00Z'))).toEqual(period)
    expect(importPeriod(new Date('2026-11-02T10:00:00Z'))).toEqual({
      from: '2026-10-20',
      to: '2026-11-02',
    })
  })
  it('reads all pages, preserving the period and excluding payments and returns', () => {
    const row = (id: string, title: string) =>
      `<tr><td><a href="/uk/accounting/transactions/${id}/">${title}</a></td></tr>`
    const html = `${auth}<table><tr><td>Дата</td><td>Коментар1</td><td>Баланс</td></tr>${row('234928', comment)}${row('2', 'Возврат от покупателя 123 от 17.11.2026')}${row('3', 'Приходный кассовый ордер 123 от 17.11.2026')}${row('4', comment.replace('18.11.2026', '05.11.2026'))}</table><a href="?date=06.11.2026-19.11.2026&amp;page=2">2</a>`
    const result = parseList(html, listUrl(period), period)
    expect(result.receipts).toEqual([ref])
    expect(result.next).toContain('page=2')
  })
  it('preserves article punctuation and exact decimal values', () => {
    expect(parseReceipt(detail, ref).lines).toEqual([
      {
        brand: 'ELRING',
        article: '001.580',
        name: 'Прокладка & комплект',
        quantity: '2',
        unitPrice: '617.25',
        amount: '1234.50',
      },
    ])
  })
  it('rejects a login page, missing structure, mismatched numbers and incorrect totals', () => {
    expect(() => parseList('<input name="password">', listUrl(period), period)).toThrow('увійти')
    expect(() => parseList(auth, listUrl(period), period)).toThrow('структура')
    expect(() => parseReceipt(detail, { ...ref, number: 'other' })).toThrow()
    expect(() => parseReceipt(detail.replace('-1 234,50', '-1 235,50'), ref)).toThrow()
    expect(() => parseReceipt(detail.replace('617,25', '617,26'), ref)).toThrow()
  })
  it('imports products with an empty supplier name using manufacturer and article', () => {
    const emptyName = detail.replace('Прокладка &amp; комплект', '')
    expect(parseReceipt(emptyName, ref).lines[0].name).toBe('ELRING 001.580')
  })
  it('rejects foreign redirects before transmitting credentials or cookies', async () => {
    let count = 0
    const client = new UkrcarClient(async () => {
      count++
      return new Response('', { status: 302, headers: { location: 'https://example.com/' } })
    })
    await expect(client.request('/uk/users/login/')).rejects.toThrow('адреса')
    expect(count).toBe(1)
  })
  it('carries CSRF and session cookies through the login POST and redirect', async () => {
    const requests: { url: string; init?: RequestInit }[] = []
    const client = new UkrcarClient(async (url, init) => {
      requests.push({ url: String(url), init })
      if (requests.length === 1)
        return new Response('<input name="csrfmiddlewaretoken" value="csrf-test">', {
          headers: { 'set-cookie': 'csrftoken=test; Path=/' },
        })
      if (requests.length === 2)
        return new Response('', {
          status: 302,
          headers: {
            'set-cookie': 'sessionid=session; Path=/',
            location: '/uk/accounting/transactions/',
          },
        })
      return new Response(auth)
    })
    await client.login({ username: 'test', password: 'secret&value' })
    expect(new URLSearchParams(String(requests[1].init?.body)).get('password')).toBe('secret&value')
    expect(new URLSearchParams(String(requests[1].init?.body)).get('csrfmiddlewaretoken')).toBe(
      'csrf-test'
    )
    expect(new Headers(requests[2].init?.headers).get('cookie')).toContain('sessionid=session')
    expect(requests[2].init?.body).toBeUndefined()
  })
})
