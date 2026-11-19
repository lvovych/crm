export interface ReceiptReference {
  externalId: string
  number: string
  date: string
  url: string
}
export interface ImportedLine {
  brand: string
  article: string
  name: string
  quantity: string
  unitPrice: string
  amount: string
}
export interface ImportedReceipt extends ReceiptReference {
  lines: ImportedLine[]
}

/** Fourteen calendar dates, including today, in the supplier's timezone. */
export function importPeriod(now = new Date()) {
  const to = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  const start = new Date(`${to}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - 13)
  return { from: start.toISOString().slice(0, 10), to }
}
