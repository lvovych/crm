// @vitest-environment node
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isValidElement, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import '@/features/vehicles/Components/invoice-pdf/fonts'
import { CompletionActPDF } from '@/features/invoices/Pdf/completion-act/CompletionActPDF'
import { renderCompletionAct } from '@/features/invoices/Pdf/completion-act/renderCompletionAct'
import type { InvoiceData } from '@/features/vehicles/Components/invoice-pdf/types'

const provider = { name: 'Test Workshop', address: '', phone: '', code: '', bank: '' }
const invoice: InvoiceData = {
  id: 'act-test',
  title: 'Repair',
  description: null,
  type: 'repair',
  serviceDate: new Date('2026-10-29T12:00:00Z'),
  shopName: null,
  techName: null,
  mileage: null,
  diagnosticNotes: null,
  invoiceNotes: null,
  subtotal: 500,
  taxRate: 0,
  taxAmount: 0,
  totalAmount: 500,
  cost: 500,
  invoiceNumber: 'TEST-1',
  vehicle: null,
  partItems: [
    {
      name: 'Oil filter',
      brand: 'BOSCH',
      partNumber: null,
      quantity: 1,
      unitPrice: 200,
      total: 200,
    },
  ],
  laborItems: [{ description: 'Replace oil filter', hours: 1, rate: 300, total: 300 }],
}

// Read the actual rendered Text children, including the private table component.
function textNodes(node: ReactNode): string[] {
  if (node == null || typeof node === 'boolean') return []
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  if (Array.isArray(node)) return node.flatMap(textNodes)
  if (!isValidElement<{ children?: ReactNode }>(node)) return []
  if (typeof node.type === 'function') {
    return textNodes((node.type as (props: unknown) => ReactNode)(node.props))
  }
  return textNodes(node.props.children)
}
function text(data: InvoiceData) {
  return textNodes(CompletionActPDF({ data, provider }))
}

describe('completion act discount column', () => {
  it.each([
    {},
    { discountType: 'none', discountValue: 10 },
    { discountType: 'percentage', discountValue: 0 },
    { discountType: 'fixed', discountValue: 0 },
  ])('omits the entire column for absent or zero discounts: %j', (discount) => {
    const nodes = text({ ...invoice, partItems: [{ ...invoice.partItems[0], ...discount }] })
    expect(nodes).not.toContain('Знижка')
    expect(nodes).not.toContain('Сума зі знижкою')
    expect(nodes).toContain('BOSCH')
    expect(nodes.filter((v) => v === 'Сума без ПДВ')).toHaveLength(2)
  })

  it.each([
    'partItems',
    'laborItems',
  ] as const)('shows the column for a discount only in %s', (kind) => {
    const data = structuredClone(invoice)
    Object.assign(data[kind][0], { discountType: 'percentage', discountValue: 10 })
    const nodes = text(data)
    expect(nodes.filter((v) => v === 'Знижка')).toHaveLength(2)
    expect(nodes).toContain('10%')
    expect(nodes).toContain('—')
  })

  it('checks all rows and prints a fixed discount', () => {
    const nodes = text({
      ...invoice,
      partItems: [
        invoice.partItems[0],
        {
          ...invoice.partItems[0],
          discountType: 'fixed',
          discountValue: 25,
          total: 175,
        },
      ],
    })
    expect(nodes.filter((v) => v === 'Знижка')).toHaveLength(2)
    expect(nodes).toContain('25,00')
    expect(nodes).toContain('175,00')
  })

  it('keeps an order-level discount in totals without inventing line discounts', () => {
    const nodes = text({ ...invoice, discountAmount: 50, totalAmount: 450 })
    expect(nodes).not.toContain('Знижка')
    expect(nodes).toContain('Знижка:')
    expect(nodes).toContain('50,00')
  })

  it.each([false, true])('renders a real PDF, discounted=%s', async (discounted) => {
    const data = structuredClone(invoice)
    if (discounted) {
      Object.assign(data.partItems[0], {
        discountType: 'percentage',
        discountValue: 10,
        total: 180,
      })
      data.totalAmount = 480
    }
    const pdf = await renderCompletionAct({ data, provider })
    expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe('%PDF-')
    if (process.env.ACT_PDF_PREVIEW_DIR) {
      mkdirSync(process.env.ACT_PDF_PREVIEW_DIR, { recursive: true })
      writeFileSync(
        join(process.env.ACT_PDF_PREVIEW_DIR, `act-${discounted ? 'discount' : 'no-discount'}.pdf`),
        pdf
      )
    }
  })
})
