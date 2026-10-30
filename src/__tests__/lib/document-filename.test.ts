import { describe, expect, it } from 'vitest'
import { documentFilename, downloadFilename, pdfDisposition } from '@/lib/document-filename'
describe('work-order document download names', () => {
  it('uses the same order number for invoices and acts', () => {
    const record = { id: 'internal-id', invoiceNumber: 'MRD-8139-3413930' }
    expect(documentFilename('invoice', record)).toBe('invoice-MRD-8139-3413930.pdf')
    expect(documentFilename('complete_work', record)).toBe('complete_work-MRD-8139-3413930.pdf')
  })
  it('preserves Unicode numbers through an HTTP header and a browser download', () => {
    const filename = documentFilename('complete_work', { id: 'a', invoiceNumber: 'НЗ-2026-001' })
    const header = pdfDisposition(filename, 'inline')
    expect(() => new Headers({ 'Content-Disposition': header })).not.toThrow()
    expect(downloadFilename(header)).toBe('complete_work-НЗ-2026-001.pdf')
  })
  it('prevents header injection and path separators', () => {
    const filename = documentFilename('invoice', {
      id: 'a',
      invoiceNumber: '../bad\\name\r\n".pdf',
    })
    expect(filename).not.toMatch(/[\r\n/\\"]/)
    expect(() => new Headers({ 'Content-Disposition': pdfDisposition(filename) })).not.toThrow()
  })
  it('has a useful fallback and tolerates malformed external headers', () => {
    expect(documentFilename('invoice', { id: 'order-id', invoiceNumber: ' ' })).toBe(
      'invoice-order-id.pdf'
    )
    expect(
      downloadFilename('attachment; filename="invoice-A.pdf"; filename*=UTF-8\'\'%broken')
    ).toBe('invoice-A.pdf')
  })
})
