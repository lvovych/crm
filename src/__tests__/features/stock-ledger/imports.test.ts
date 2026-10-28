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

describe('import numerical validation and XLSX', () => {
  it.each([
    ['0.0001', '1', '0'],
    ['1', '1.0000001', '0'],
    ['1', '10', '10.01'],
    ['1e3', '1', '0'],
    ['1', 'NaN', '0'],
    ['1', '-1', '0'],
  ])('does not silently round or accept invalid q=%s p=%s discount=%s', async (q, p, d) => {
    const result = await parsePurchaseFile(
      Buffer.from(`Артикул;Бренд;Кількість;Ціна;Знижка\nA;---;${q};${p};${d}`),
      'csv',
      { ...mapping, discount: 'Знижка' }
    )
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].errors.length).toBeGreaterThan(0)
  })
  it('preserves precision and decimal commas with BOM', async () => {
    const result = await parsePurchaseFile(
      Buffer.from('\uFEFFАртикул;Бренд;Кількість;Ціна;Знижка\nA;---;0,333;1,234567;0,01'),
      'csv',
      { ...mapping, discount: 'Знижка' }
    )
    expect(result.rows[0]).toMatchObject({
      quantity: '0.333',
      unitPrice: '1.234567',
      discountValue: '0.01',
      errors: [],
    })
  })
  it('rejects empty, malformed, oversized or missing-column files', async () => {
    for (const bytes of [
      Buffer.alloc(0),
      Buffer.alloc(10 * 1024 * 1024 + 1),
      Buffer.from('A;B\n1;2'),
      Buffer.from('Артикул;Бренд;Кількість;Ціна\n"unterminated'),
    ])
      await expect(parsePurchaseFile(bytes, 'csv', mapping)).rejects.toThrow()
    await expect(
      parsePurchaseFile(
        Buffer.from('Артикул;Бренд;Кількість;Ціна\n' + 'A;---;1;1\n'.repeat(10001)),
        'csv',
        mapping
      )
    ).rejects.toThrow()
  })
  it('reads real XLSX numeric and text cells without executing formulas', async () => {
    const { Workbook } = await import('exceljs')
    const workbook = new Workbook(),
      sheet = workbook.addWorksheet('Receipt')
    sheet.addRow(['Артикул', 'Бренд', 'Кількість', 'Ціна'])
    sheet.addRow(['A', '---', 0.333, 1.234567])
    sheet.addRow(['B', '---', 1, { formula: '1+1', result: 2 }])
    sheet.addRow(['C', '---', 1, { text: '10', hyperlink: 'https://example.test' }])
    const result = await parsePurchaseFile(
      Buffer.from(await workbook.xlsx.writeBuffer()),
      'xlsx',
      mapping
    )
    expect(result.rows[0]).toMatchObject({ quantity: '0.333', unitPrice: '1.234567', errors: [] })
    expect(result.rows).toHaveLength(3)
    expect(result.rows[1].errors.length).toBeGreaterThan(0)
    expect(result.rows[2].errors.length).toBeGreaterThan(0)
  })
  it('rejects empty XLSX and excessive ZIP entries before spreadsheet parsing', async () => {
    const { Workbook } = await import('exceljs')
    await expect(
      parsePurchaseFile(Buffer.from(await new Workbook().xlsx.writeBuffer()), 'xlsx', mapping)
    ).rejects.toThrow()
    const JSZip = (await import('jszip')).default,
      zip = new JSZip()
    for (let i = 0; i < 501; i++) zip.file(`file${i}`, '')
    await expect(
      parsePurchaseFile(await zip.generateAsync({ type: 'nodebuffer' }), 'xlsx', mapping)
    ).rejects.toThrow('об’єктів')
  })
})

describe('source totals', () => {
  it.each([
    ['3.01', false],
    ['3.02', true],
    ['oops', true],
  ])('checks source total %s without silently changing it', async (total, bad) => {
    const p = await parsePurchaseFile(
      Buffer.from(`Артикул;Бренд;Кількість;Ціна;Сума\nA;---;3;1.003333;${total}`),
      'csv',
      { ...mapping, lineTotal: 'Сума' }
    )
    expect(p.rows[0].errors.length > 0).toBe(bad)
  })
})
