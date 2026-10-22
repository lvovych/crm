// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { parsePurchaseFile, normalizeArticle } from '@/features/stock-ledger/Lib/imports'
const mapping = { article: 'Артикул', brand: 'Бренд', quantity: 'Кількість', unitPrice: 'Ціна' }
describe('purchase import preview', () => {
  it('preserves unknown brand and decimal text', async () => {
    const p = await parsePurchaseFile(
      Buffer.from('Артикул;Бренд;Кількість;Ціна\nA-10;---;1,5;100,25'),
      'csv',
      mapping
    )
    expect(p.rows[0].quantity).toBe('1.5')
    expect(p.rows[0].unitPrice).toBe('100.25')
    expect(p.rows[0].brand).toBe('---')
    expect(p.rows[0].errors).toEqual([])
  })
  it('flags formulas and never silently skips a bad row', async () => {
    const p = await parsePurchaseFile(
      Buffer.from('Артикул;Бренд;Кількість;Ціна\n=IMPORTXML();Brand;1;10\nA;Brand;-1;10'),
      'csv',
      mapping
    )
    expect(p.rows).toHaveLength(2)
    expect(p.rows.every((r) => r.errors.length > 0)).toBe(true)
  })
  it('detects identical files by content and normalizes article separators', async () => {
    const bytes = Buffer.from('Артикул;Бренд;Кількість;Ціна\nA;Brand;1;10')
    const a = await parsePurchaseFile(bytes, 'csv', mapping),
      b = await parsePurchaseFile(bytes, 'csv', mapping)
    expect(a.fileHash).toBe(b.fileHash)
    expect(normalizeArticle(' ab-12 / C ')).toBe('AB12C')
  })
})
