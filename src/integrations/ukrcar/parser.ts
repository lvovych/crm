import type {
  ReceiptReference,
  ImportedLine,
  ImportedReceipt,
} from '@/features/receipts/import-types'
import { load } from 'cheerio'
import { lineCents, decimalAmount } from '@/features/receipts/money'
import { parseFixed } from '@/lib/exact-money'

export const ORIGIN = 'https://ukrcar.ua'
export const TRANSACTIONS = '/uk/accounting/transactions/'
const text = (s: string) => s.replace(/\s+/g, ' ').trim()
const changed = () =>
  new Error('Укркар: структура документа змінилася або дані неповні. Імпорт зупинено.')

export type {
  ReceiptReference,
  ImportedLine,
  ImportedReceipt,
} from '@/features/receipts/import-types'
export { importPeriod } from '@/features/receipts/import-types'

export function isoDay(value: string): string {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value)
  if (!match) throw changed()
  const result = `${match[3]}-${match[2]}-${match[1]}`
  const date = new Date(`${result}T00:00:00Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== result)
    throw changed()
  return result
}

export function listUrl(period: { from: string; to: string }) {
  const format = (s: string) => s.split('-').reverse().join('.')
  return `${ORIGIN}${TRANSACTIONS}?${new URLSearchParams({ date: `${format(period.from)}-${format(period.to)}` })}`
}

function reference(comment: string, href: string): ReceiptReference {
  const match = /^Реализация товаров\s+(\d+)\s+от\s+(\d{2}\.\d{2}\.\d{4})(?:\s|$)/.exec(
    text(comment)
  )
  const url = new URL(href, ORIGIN)
  const id = /^\/uk\/accounting\/transactions\/(\d+)\/$/.exec(url.pathname)
  if (!match || !id || url.origin !== ORIGIN) throw changed()
  return { number: match[1], date: isoDay(match[2]), externalId: id[1], url: url.href }
}

export function assertAuthenticated(html: string) {
  const $ = load(html)
  if (!$('a[href="/uk/users/logout/"]').length || $('input[name="password"]').length) {
    throw new Error(
      'Укркар: не вдалося увійти. Перевірте логін і пароль у налаштуваннях інтеграції.'
    )
  }
}

export function parseList(html: string, currentUrl: string, period: { from: string; to: string }) {
  assertAuthenticated(html)
  const $ = load(html)
  const table = $('table').filter(
    (_, el) =>
      /Дата/.test($(el).text()) && /Коментар/.test($(el).text()) && /Баланс/.test($(el).text())
  )
  if (table.length !== 1) throw changed()
  const receipts: ReceiptReference[] = []
  table.find('tr').each((_, row) => {
    const cells = $(row).find('td')
    if (!cells.length) return
    const links = $(row).find('a[href]')
    const document = links
      .filter((_, el) =>
        /^(Реализация товаров|Возврат от покупателя|Приходный кассовый ордер)/.test(
          text($(el).text())
        )
      )
      .first()
    if (!document.length) {
      // Header rows use td on this site; an unrecognised transaction must not silently disappear.
      if (links.length) throw changed()
      return
    }
    const comment = text(document.text())
    if (!comment.startsWith('Реализация товаров')) return
    const item = reference(comment, document.attr('href')!)
    if (item.date >= period.from && item.date <= period.to) receipts.push(item)
  })
  const current = new URL(currentUrl)
  const page = Number(current.searchParams.get('page') || 1)
  let next: string | null = null
  $('a[href]').each((_, el) => {
    const url = new URL($(el).attr('href')!, currentUrl)
    if (
      url.origin === ORIGIN &&
      url.pathname === TRANSACTIONS &&
      Number(url.searchParams.get('page')) === page + 1
    ) {
      if (url.searchParams.get('date') !== current.searchParams.get('date')) throw changed()
      next = url.href
    }
  })
  return { receipts, next }
}

function decimal(value: string, scale: number, money = false): string {
  let v = text(value)
  if (money) {
    if (!/грн\.?$/.test(v)) throw changed()
    v = v.replace(/\s*грн\.?$/, '')
  }
  v = v.replace(/\s/g, '').replace(',', '.')
  if (!new RegExp(`^\\d{1,9}(\\.\\d{1,${scale}})?$`).test(v)) throw changed()
  return v
}

export function parseReceipt(html: string, expected: ReceiptReference): ImportedReceipt {
  assertAuthenticated(html)
  const $ = load(html)
  const values = new Map<string, string>()
  $('dl').each((_, el) => {
    values.set(text($(el).find('dt').text()), text($(el).find('dd').text()))
  })
  const actual = reference(values.get('Коментар') || '', expected.url)
  if (actual.number !== expected.number || actual.date !== expected.date) throw changed()
  const table = $('table').filter(
    (_, el) =>
      /Виробник/.test($(el).text()) && /К-ть/.test($(el).text()) && /Всього/.test($(el).text())
  )
  if (table.length !== 1) throw changed()
  const lines: ImportedLine[] = []
  table.find('tr').each((_, row) => {
    const cells = $(row)
      .find('td')
      .toArray()
      .map((el) => text($(el).text()))
    if (!cells.length || cells[0] === 'Виробник') return
    if (cells.length !== 6) throw changed()
    const [brand, article, suppliedName, qty, price, sum] = cells
    // Some real UkrCar documents have an empty product name. Keep the known
    // manufacturer/article as a visible placeholder instead of losing the document.
    const name = suppliedName || `${brand} ${article}`
    if (!brand || !article || article.length > 120 || name.length > 250) throw changed()
    const quantity = decimal(qty, 3)
    const unitPrice = decimal(price, 4, true)
    const amount = decimal(sum, 2, true)
    const cents = lineCents({ quantity, unitPrice })
    if (
      Number(quantity) <= 0 ||
      cents === null ||
      cents !== parseFixed(amount, 2, { signed: false })
    )
      throw changed()
    lines.push({ brand, article, name, quantity, unitPrice, amount: decimalAmount(cents) })
  })
  if (!lines.length || lines.length > 200) throw changed()
  const totalText = values.get('Сума') || ''
  if (!totalText.startsWith('-')) throw changed()
  const total = parseFixed(decimal(totalText.slice(1), 2, true), 2, { signed: false })
  if (
    lines.reduce((sum, l) => sum + parseFixed(l.amount, 2, { signed: false }), BigInt(0)) !== total
  )
    throw changed()
  return { ...actual, lines }
}
