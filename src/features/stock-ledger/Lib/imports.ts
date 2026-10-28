import { createHash } from 'node:crypto'
import Papa from 'papaparse'
import { z } from 'zod'
import { D, decimalText, lineSchema, calculateLine } from './amounts'
export const importMappingSchema = z.object({
  article: z.string().min(1),
  brand: z.string().min(1),
  name: z.string().optional(),
  unit: z.string().optional(),
  lineTotal: z.string().optional(),
  quantity: z.string().min(1),
  unitPrice: z.string().min(1),
  discount: z.string().optional(),
})
export type ImportMapping = z.infer<typeof importMappingSchema>
export type PreviewRow = {
  row: number
  article: string
  brand: string
  name: string
  unit?: string
  sourceTotal?: string
  quantity: string
  unitPrice: string
  discountValue: string
  errors: string[]
}
export function normalizeArticle(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleUpperCase('uk')
    .replace(/[\s\-./_]/g, '')
}
function text(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object')
    throw new Error('Формули, гіперпосилання та складні значення клітинок не підтримуються')
  const result = String(value).trim()
  if (/^[=+@\t\r]/.test(result)) throw new Error('Формули у клітинках не дозволені')
  return result
}
export async function parsePurchaseFile(
  bytes: Buffer,
  format: 'csv' | 'xlsx',
  mapping: ImportMapping
) {
  if (bytes.length > 10 * 1024 * 1024) throw new Error('Файл перевищує 10 МБ')
  const map = importMappingSchema.parse(mapping)
  let records: Record<string, unknown>[] = []
  if (format === 'csv') {
    const parsed = Papa.parse<Record<string, string>>(
      bytes.toString('utf8').replace(/^\uFEFF/, ''),
      { header: true, skipEmptyLines: 'greedy' }
    )
    if (parsed.errors.length) throw new Error('Некоректний CSV: ' + parsed.errors[0].message)
    records = parsed.data
  } else {
    // Inspect ZIP metadata before ExcelJS inflates worksheets; reject zip bombs.
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(bytes)
    const entries = Object.values(zip.files)
    if (entries.length > 500) throw new Error('Занадто багато об’єктів XLSX')
    const inflated = entries.reduce(
      (s, e) =>
        s +
        ((e as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0),
      0
    )
    if (inflated > 50 * 1024 * 1024) throw new Error('Розпакований XLSX перевищує 50 МБ')
    const ExcelJS = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0])
    const sheet = workbook.worksheets[0]
    if (!sheet) throw new Error('Таблиця порожня')
    if (sheet.rowCount > 10001) throw new Error('Максимум 10 000 рядків')
    const headers = (sheet.getRow(1).values as unknown[]).slice(1).map(text)
    sheet.eachRow((row, index) => {
      if (index === 1) return
      const record: Record<string, unknown> = {}
      headers.forEach((h, i) => {
        record[h] = row.getCell(i + 1).value
      })
      records.push(record)
    })
  }
  if (records.length === 0 || records.length > 10000)
    throw new Error('Файл має містити від 1 до 10 000 рядків')
  for (const column of Object.values(map))
    if (column && !Object.hasOwn(records[0], column))
      throw new Error('Не знайдено колонку: ' + column)
  const rows: PreviewRow[] = records.map((r, index) => {
    const errors: string[] = []
    const read = (key: string | undefined) => {
      try {
        return key ? text(r[key]) : ''
      } catch (e) {
        errors.push((e as Error).message)
        return ''
      }
    }
    const row = {
      row: index + 2,
      article: read(map.article),
      brand: read(map.brand),
      name: read(map.name),
      unit: read(map.unit),
      sourceTotal: read(map.lineTotal).replace(',', '.'),
      quantity: read(map.quantity).replace(',', '.'),
      unitPrice: read(map.unitPrice).replace(',', '.'),
      discountValue: read(map.discount).replace(',', '.') || '0',
      errors,
    }
    if (!row.article || !row.brand)
      errors.push('Вкажіть артикул і бренд; невідомий бренд позначайте ---')
    const parsed = lineSchema.safeParse({
      inventoryPartId: 'preview',
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      discountType: 'AMOUNT',
      discountValue: row.discountValue,
    })
    if (!parsed.success) errors.push('Перевірте кількість, ціну та знижку')
    else {
      try {
        const calculated = calculateLine(parsed.data)
        if (
          map.lineTotal &&
          (!decimalText.safeParse(row.sourceTotal).success ||
            !D(row.sourceTotal).eq(calculated.totalAmount))
        )
          errors.push('Сума рядка не збігається з кількістю, ціною та знижкою')
      } catch (e) {
        errors.push((e as Error).message)
      }
    }
    return row
  })
  return { fileHash: createHash('sha256').update(bytes).digest('hex'), rows }
}
