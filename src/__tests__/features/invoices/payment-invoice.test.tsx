// @vitest-environment node
import { getTorqvoiceLogoDataUri } from '@/lib/torqvoice-branding'
import { numberInvoicePages } from '@/features/invoices/Pdf/payment-invoice/numberPages'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isValidElement, type ReactNode } from 'react'
import { Document, renderToBuffer } from '@react-pdf/renderer'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import '@/features/vehicles/Components/invoice-pdf/fonts'
import { PaymentInvoicePage } from '@/features/invoices/Pdf/payment-invoice/PaymentInvoicePage'
import type { InvoicePrintInput } from '@/features/invoice-designer/Pdf/buildInvoicePrint'

const input: InvoicePrintInput = {
  data: {
    id: 'sample-order',
    title: 'Ремонт автомобіля',
    type: 'repair',
    description: null,
    serviceDate: new Date('2026-09-04T12:00:00Z'),
    invoiceDate: new Date('2026-09-04T12:00:00Z'),
    invoiceNumber: 'DEMO-2026-001',
    shopName: null,
    techName: null,
    mileage: 400051,
    diagnosticNotes: 'PRIVATE INTERNAL NOTE',
    invoiceNotes: null,
    subtotal: 16200,
    taxRate: 0,
    taxAmount: 0,
    totalAmount: 16200,
    cost: 16200,
    customer: {
      name: 'Тестовий клієнт',
      phone: '+380 00 000 0001',
      email: null,
      address: null,
      company: null,
    },
    vehicle: {
      make: 'MERCEDES-BENZ',
      model: 'VITO / MIXTO Фургон (W639)',
      year: 2004,
      vin: 'WDF63960113000000',
      licensePlate: 'ТЕСТ0001',
      mileage: 400051,
      customer: null,
    },
    laborItems: [
      {
        description: 'Ремонт генератора',
        hours: 1,
        rate: 5400,
        total: 5400,
        pricingType: 'service',
      },
      {
        description: 'Заміна насоса охолоджуючої рідини (помпи)',
        hours: 1,
        rate: 3000,
        total: 3000,
        pricingType: 'service',
      },
    ],
    partItems: [
      {
        name: 'Помпа води MB Sprinter 906 2.2CDI OM646 06-13/Vito (W639) 2.0-2.2CDI 03-',
        brand: 'Graf',
        quantity: 1,
        unitPrice: 2550,
        total: 2550,
        partNumber: null,
      },
      {
        name: 'Комплект ременя генератора MB Sprinter/Vito 2.2-2.7 CDI 00-06',
        brand: 'INA',
        quantity: 1,
        unitPrice: 4864,
        total: 4864,
        partNumber: '6PK2260',
      },
      {
        name: 'Очисник (500 мл)',
        brand: 'Rowe',
        quantity: 1,
        unitPrice: 186,
        total: 186,
        partNumber: null,
      },
      {
        name: 'Антифриз (синій) Readymix G11 (-35°C)',
        brand: 'Febi Bilstein',
        quantity: 2,
        unitPrice: 100,
        total: 200,
        partNumber: null,
      },
    ],
  },
  workshop: {
    name: 'Приклад виконавця',
    address: 'м. Луцьк, Приклад вулиці, 1',
    phone: '+380 00 000 0002',
    email: '',
  },
  invoiceSettings: {
    currencyCode: 'UAH',
    timezone: 'Europe/Kyiv',
    orgNumber: '12345678',
    bankAccount: 'IBAN UA000000000000000000000000000\nБанк Приклад банку',
  },
  paymentSummary: {
    totalPaid: 16200,
    payments: [{ amount: 16200, date: '05.09.2026', method: 'cash' }],
  },
  logoDataUri: `data:image/png;base64,${readFileSync(join(process.cwd(), 'public/lauto-act-logo.png')).toString('base64')}`,
}
function text(node: ReactNode): string[] {
  if (node == null || typeof node === 'boolean') return []
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  if (Array.isArray(node)) return node.flatMap(text)
  if (!isValidElement<{ children?: ReactNode }>(node)) return []
  if (typeof node.type === 'function')
    return text((node.type as (p: unknown) => ReactNode)(node.props))
  return text(node.props.children)
}
const words = (props: InvoicePrintInput) => text(PaymentInvoicePage(props)).join(' ')
describe('Ukrainian payment invoice', () => {
  it('uses captured legal provider details and includes customer notes only', () => {
    const content = words({
      ...input,
      workshop: {
        ...input.workshop!,
        paymentProvider: {
          name: 'Captured provider',
          address: 'Captured address',
          phone: '123',
          code: '456',
          bank: 'Captured IBAN',
        },
      },
      data: { ...input.data, invoiceNotes: '<p>Customer-visible note</p>' },
    })
    expect(content).toContain('Captured provider')
    expect(content).toContain('Captured IBAN')
    expect(content).toContain('Customer-visible note')
    expect(content).not.toContain('PRIVATE INTERNAL NOTE')
  })

  it('prints separate work/parts, payment and outstanding balance without private notes', () => {
    const content = words(input)
    expect(content).toContain('Рахунок на оплату')
    expect(content).toContain('Найменування (характеристика) послуг')
    expect(content).toContain('Найменування запасних частин')
    expect(content).toContain('Оплачено 05.09.2026')
    expect(content).toContain('Шістнадцять тисяч двісті гривень')
    expect(content).not.toContain('PRIVATE INTERNAL NOTE')
    expect(content).not.toContain('Знижка')
  })
  it('converts tax-inclusive prices to net and preserves discount and partial payments', () => {
    const data = {
      ...input.data,
      partItems: [
        {
          ...input.data.partItems[0],
          unitPrice: 120,
          total: 108,
          discountType: 'percentage',
          discountValue: 10,
        },
      ],
      laborItems: [],
      subtotal: 108,
      taxInclusive: true,
      taxRate: 20,
      taxAmount: 18,
      totalAmount: 108,
    }
    const content = words({
      ...input,
      data,
      paymentSummary: {
        totalPaid: 50,
        payments: [{ amount: 50, date: '30.10.2026', method: 'cash' }],
      },
    })
    expect(content).toContain('100,00')
    expect(content).toContain('90,00')
    expect(content).toContain('18,00')
    expect(content).toContain('58,00')
    expect(content).toContain('10%')
  })
  it('explains manually settled balances and displays overpayments', () => {
    const manual = words({
      ...input,
      paymentSummary: {
        totalPaid: 16200,
        payments: [{ amount: 200, date: '05.09.2026', method: 'cash' }],
      },
    })
    expect(manual).toContain('Позначено оплаченим')
    expect(manual.replace(/\s/g, '')).toContain('16000,00')
    const overpaid = words({ ...input, paymentSummary: { totalPaid: 16300, payments: [] } })
    expect(overpaid).toContain('Переплата')
    expect(overpaid).toContain('100,00')
  })

  it('renders a compact reference and a long invoice without broken PDF output', async () => {
    const dir = process.env.PDF_REVIEW_DIR
    const longParts = Array.from({ length: 70 }, (_, i) => ({
      ...input.data.partItems[i % 4],
      name: `${i + 1}. ${input.data.partItems[i % 4].name}`,
    }))
    const longTotal = longParts.reduce((sum, line) => sum + line.total, 8400)
    const cases = [
      ['invoice-DEMO-2026-001.pdf', input],
      [
        'invoice-long.pdf',
        {
          ...input,
          paymentSummary: undefined,
          data: {
            ...input.data,
            partItems: longParts,
            subtotal: longTotal,
            totalAmount: longTotal,
            cost: longTotal,
          },
        },
      ],
    ] as const
    for (const [name, props] of cases) {
      const raw = await renderToBuffer(
        <Document>
          <PaymentInvoicePage {...props} torqvoiceLogoDataUri={await getTorqvoiceLogoDataUri()} />
        </Document>
      )
      const buffer = await numberInvoicePages(raw)
      const pdf = await PDFDocument.load(buffer)
      if (name.includes('long')) expect(pdf.getPageCount()).toBeGreaterThan(1)
      else expect(pdf.getPageCount()).toBe(1)
      if (dir) {
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, name), buffer)
      }
    }
  }, 30000)
})
