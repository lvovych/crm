import { PaymentInvoicePage } from '@/features/invoices/Pdf/payment-invoice/PaymentInvoicePage'
import { Document, Image, Page, Text, View } from '@react-pdf/renderer'
import { buildInvoicePrintSpec } from '@/features/invoice-designer/Pdf/buildInvoicePrint'
import type { VisitConditionMap } from '@/features/condition-map/Lib/print'
import { pdfFamily, RenderNodePdf } from '@/features/invoice-designer/Pdf/renderPdf'
import { SpecPdfPage } from '@/features/invoice-designer/Pdf/SpecPdf'
import type {
  ImageAttachment,
  InvoiceData,
  InvoiceSettingsProps,
  OtherAttachment,
  PaymentSummary,
  TemplateConfig,
  WorkshopInfo,
} from './types'

/**
 * The printed invoice.
 *
 * Ukrainian automotive invoices use the compact payment sheet. Other invoices
 * use the document the designer edits: the same generator
 * builds the same blocks, laid out by the same engine, so an invoice prints
 * the way the workshop arranged it — hand-placed sections, narrowed widths,
 * spacing and all. This file only maps the job onto that document and
 * appends the attachment pages.
 */
export function InvoicePDF({
  data,
  workshop,
  invoiceSettings,
  paymentSummary,
  imageAttachments = [],
  otherAttachments = [],
  pdfAttachmentNames = [],
  logoDataUri,
  signer,
  template,
  torqvoiceLogoDataUri,
  portalUrl,
  telegramQrDataUri,
  telegramLabel,
  labels = {},
  conditionMap,
  ukrainianLayout = false,
}: {
  ukrainianLayout?: boolean
  data: InvoiceData
  workshop?: WorkshopInfo
  invoiceSettings?: InvoiceSettingsProps
  paymentSummary?: PaymentSummary
  imageAttachments?: ImageAttachment[]
  otherAttachments?: OtherAttachment[]
  pdfAttachmentNames?: string[]
  logoDataUri?: string
  signer?: { name: string; dataUri?: string }
  template?: TemplateConfig
  torqvoiceLogoDataUri?: string
  portalUrl?: string
  telegramQrDataUri?: string
  telegramLabel?: string
  labels?: Record<string, string>
  conditionMap?: VisitConditionMap
}) {
  const spec = buildInvoicePrintSpec({
    data,
    workshop,
    invoiceSettings,
    paymentSummary,
    pdfAttachmentNames,
    otherAttachmentNames: otherAttachments.map((att) => att.fileName),
    logoDataUri,
    signer,
    template,
    torqvoiceLogoDataUri,
    portalUrl,
    telegramQrDataUri,
    telegramLabel,
    labels,
    conditionMap,
  })

  const shopDisplayName = workshop?.name || data.shopName || 'Torqvoice'
  const invoiceNum = data.invoiceNumber || `INV-${data.id.slice(-8).toUpperCase()}`
  const fontFamily = pdfFamily(spec.page.fontFamily)

  return (
    <Document>
      {ukrainianLayout ? (
        <PaymentInvoicePage
          data={data}
          workshop={workshop}
          invoiceSettings={invoiceSettings}
          paymentSummary={paymentSummary}
          logoDataUri={logoDataUri}
          signer={signer}
          portalUrl={portalUrl}
          telegramQrDataUri={telegramQrDataUri}
          torqvoiceLogoDataUri={torqvoiceLogoDataUri}
          labels={labels}
        />
      ) : (
        <SpecPdfPage spec={spec} />
      )}

      {ukrainianLayout &&
        spec.blocks
          .filter((block) => block.id === 'condition_map')
          .map((block) => (
            <Page
              key={block.id}
              size="A4"
              style={{ padding: 28, fontFamily: 'Roboto', fontSize: 9 }}
            >
              <RenderNodePdf
                node={block.content}
                base={{ fontFamily: 'Roboto', fontSize: 9, color: '#17191d' }}
              />
            </Page>
          ))}

      {imageAttachments.length > 0 && (
        <Page size="A4" style={{ padding: 40, fontFamily, fontSize: 9, color: '#111827' }}>
          <Text style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>
            {labels.serviceImages || 'Service Images'}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {imageAttachments.map((img, i) => (
              <View key={i} style={{ width: '48%', marginBottom: 8 }}>
                <Image
                  src={img.dataUri}
                  style={{
                    maxHeight: 250,
                    borderRadius: 4,
                    objectFit: 'contain',
                    objectPosition: 'left',
                  }}
                />
                <Text style={{ fontSize: 8, color: '#6b7280', marginTop: 2 }}>
                  {img.description || img.fileName}
                </Text>
              </View>
            ))}
          </View>
          <Text
            fixed
            style={{
              position: 'absolute',
              bottom: 16,
              left: 40,
              right: 40,
              fontSize: 8,
              color: '#6b7280',
              textAlign: 'center',
            }}
          >
            {shopDisplayName} · {invoiceNum}
          </Text>
        </Page>
      )}
    </Document>
  )
}
