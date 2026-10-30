import { Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { InvoicePrintInput } from '@/features/invoice-designer/Pdf/buildInvoicePrint'
import { documentLaborLines, isShopFeeLine } from '@/features/settings/Lib/shopFee'
import { HtmlToPdf } from '@/features/vehicles/Components/invoice-pdf/Notes'
import { warrantyForPrint } from '@/features/invoice-designer/Pdf/warrantyPrint'
import { parseTaxComponents } from '@/lib/tax-components'
import { calculateTotals, discountAmountFor, netLineTotal } from '@/lib/tax'
import { hryvniaWords } from '../completion-act/moneyWords'

const s = StyleSheet.create({
  page: {
    fontFamily: 'Roboto',
    fontSize: 8,
    color: '#17191d',
    padding: 28,
    paddingBottom: 38,
    lineHeight: 1.18,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  logo: { width: 178, height: 62, objectFit: 'contain', objectPosition: 'left' },
  heading: { width: 300, fontSize: 13, lineHeight: 1.3, fontWeight: 700, textAlign: 'right' },
  parties: { flexDirection: 'row', gap: 24, marginBottom: 5 },
  party: { width: '48%' },
  partyTitle: { fontWeight: 700, fontSize: 11, lineHeight: 1.25, marginBottom: 7 },
  detail: { marginBottom: 2 },
  vehicle: {
    borderTopWidth: 0.8,
    borderBottomWidth: 0.8,
    paddingVertical: 4,
    marginBottom: 9,
    fontSize: 10,
    lineHeight: 1.3,
    fontWeight: 700,
  },
  section: { borderTopWidth: 1.3, fontWeight: 700, paddingTop: 2, fontSize: 8, marginTop: 4 },
  row: { flexDirection: 'row', borderBottomWidth: 0.6, paddingVertical: 3 },
  head: { borderTopWidth: 1.2, borderBottomWidth: 1, fontWeight: 700 },
  cell: { paddingHorizontal: 3 },
  subtotal: { textAlign: 'right', marginTop: 7, marginBottom: 4, fontWeight: 700 },
  total: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 4 },
  label: { width: 190, textAlign: 'right', marginRight: 12 },
  value: { width: 85, textAlign: 'right' },
  bold: { fontWeight: 700 },
  words: { marginTop: 9, marginBottom: 12, fontWeight: 700 },
  payments: { borderTopWidth: 1.3, borderBottomWidth: 1.3, paddingTop: 4, marginTop: 5 },
  signature: {
    marginTop: 4,
    width: '50%',
    alignSelf: 'flex-end',
    minHeight: 40,
    borderBottomWidth: 1.1,
  },
  footer: {
    position: 'absolute',
    bottom: 16,
    left: 28,
    right: 28,
    fontSize: 7,
    color: '#666',
    textAlign: 'right',
  },
})
const money = (n: number) =>
  n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
type Line = {
  name: string
  brand?: string
  unit: string
  quantity: number
  price: number
  total: number
  discount?: string
}
function Table({
  title,
  lines,
  parts = false,
  currency,
  discounts,
}: {
  title: string
  lines: Line[]
  parts?: boolean
  currency: string
  discounts: boolean
}) {
  const widths = parts
    ? discounts
      ? [4, 34, 12, 6, 8, 12, 10, 14]
      : [4, 40, 14, 6, 9, 13, 14]
    : discounts
      ? [4, 46, 6, 8, 12, 10, 14]
      : [5, 53, 7, 9, 12, 14]
  return (
    <View>
      <View minPresenceAhead={45}>
        <Text style={s.section}>{title}</Text>
        <View style={[s.row, s.head]}>
          {[
            '№',
            parts ? 'Назва запчастини' : 'Назва послуги',
            ...(parts ? ['Бренд'] : []),
            'Од.',
            'К-сть',
            'Ціна без ПДВ',
            ...(discounts ? ['Знижка'] : []),
            'Сума без ПДВ',
          ].map((label, i) => (
            <Text
              key={label}
              style={[
                s.cell,
                { width: `${widths[i]}%`, textAlign: i > (parts ? 3 : 2) ? 'right' : 'left' },
              ]}
            >
              {label}
            </Text>
          ))}
        </View>
      </View>
      {lines.map((line, index) => (
        <View key={index} style={s.row} wrap={false}>
          {[
            String(index + 1),
            line.name,
            ...(parts ? [line.brand || ''] : []),
            line.unit,
            money(line.quantity),
            money(line.price),
            ...(discounts ? [line.discount || ''] : []),
            money(line.total),
          ].map((value, i) => (
            <Text
              key={i}
              style={[
                s.cell,
                { width: `${widths[i]}%`, textAlign: i > (parts ? 3 : 2) ? 'right' : 'left' },
              ]}
            >
              {value}
            </Text>
          ))}
        </View>
      ))}
      <Text style={s.subtotal}>
        Сума без ПДВ, {currency}: {money(lines.reduce((sum, line) => sum + line.total, 0))}
      </Text>
    </View>
  )
}

/** Ukrainian payment sheet; amounts/parties come from the issued snapshot, never live settings. */
export function PaymentInvoicePage({
  data,
  workshop,
  invoiceSettings,
  paymentSummary,
  logoDataUri,
  signer,
  portalUrl,
  telegramQrDataUri,
  torqvoiceLogoDataUri,
  labels = {},
}: InvoicePrintInput) {
  const currency = invoiceSettings?.currencyCode || 'UAH'
  const unit = currency === 'UAH' ? 'грн' : currency
  const timezone = invoiceSettings?.timezone || 'Europe/Kyiv'
  const date = (value: Date | string) =>
    new Intl.DateTimeFormat('uk-UA', { timeZone: timezone }).format(new Date(value))
  const number = data.invoiceNumber || data.id
  const net = (value: number) => netLineTotal(value, data.taxRate, data.taxInclusive ?? false)
  const discount = (line: { discountType?: string; discountValue?: number }) =>
    (line.discountValue ?? 0) > 0
      ? line.discountType === 'percentage'
        ? `${line.discountValue}%`
        : line.discountType === 'fixed'
          ? money(net(line.discountValue!))
          : undefined
      : undefined
  const labor = documentLaborLines(data.laborItems).map((l) => ({
    name: l.description,
    quantity: l.hours,
    unit: l.pricingType === 'service' || isShopFeeLine(l) ? 'посл.' : 'н/год',
    price: net(l.rate),
    total: net(l.total),
    discount: discount(l),
  }))
  const parts = data.partItems.map((p) => ({
    name: [p.name, p.partNumber].filter(Boolean).join('\n'),
    brand: p.brand === '---' ? '' : p.brand,
    unit: p.unit || 'шт',
    quantity: p.quantity,
    price: net(p.unitPrice),
    total: net(p.total),
    discount: discount(p),
  }))
  const discounts = [...labor, ...parts].some((line) => !!line.discount)
  const customer = data.customer ?? data.vehicle?.customer
  const provider = workshop?.paymentProvider ?? {
    name: workshop?.name || data.shopName || '',
    address: workshop?.address || '',
    phone: workshop?.phone || '',
    code: invoiceSettings?.orgNumber || '',
    bank: invoiceSettings?.bankAccount || '',
  }

  const subtotal = [...data.partItems, ...documentLaborLines(data.laborItems)].reduce(
    (sum, line) => sum + line.total,
    0
  )
  const computed = calculateTotals({
    subtotal,
    discountAmount: discountAmountFor(subtotal, data.discountType, data.discountValue),
    taxRate: data.taxRate,
    taxInclusive: data.taxInclusive ?? false,
  })
  const total =
    data.totalAmount > 0
      ? data.totalAmount
      : computed.totalAmount > 0
        ? computed.totalAmount
        : data.cost
  const warranty = warrantyForPrint(data, {
    labels,
    unitSystem: invoiceSettings?.unitSystem,
    expires: data.warrantyExpiresAt ? date(data.warrantyExpiresAt) : undefined,
  })
  const paid = paymentSummary?.totalPaid ?? 0
  const recordedPaid = (paymentSummary?.payments ?? []).reduce(
    (sum, payment) => sum + payment.amount,
    0
  )
  const taxAmount =
    data.totalAmount > 0 ? data.taxAmount : computed.totalAmount > 0 ? computed.taxAmount : 0
  const totalRow = (label: string, value: string, bold = false) => (
    <View style={[s.total, ...(bold ? [s.bold] : [])]}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{value}</Text>
    </View>
  )
  return (
    <Page size="A4" style={s.page}>
      <View style={s.header} wrap={false}>
        {logoDataUri ? (
          <Image src={logoDataUri} style={s.logo} />
        ) : (
          <Text style={s.partyTitle}>{workshop?.name || data.shopName}</Text>
        )}
        <Text style={s.heading}>
          Рахунок на оплату{'\n'}№ {number}
          {'\n'}від {date(data.invoiceDate ?? data.startDateTime ?? data.serviceDate)}
        </Text>
      </View>
      <View style={s.parties} wrap={false}>
        <View style={s.party}>
          <Text style={s.partyTitle}>Виконавець: {provider.name}</Text>
          {provider.address && <Text style={s.detail}>Адреса: {provider.address}</Text>}
          {provider.code && <Text style={s.detail}>ЄДРПОУ / РНОКПП: {provider.code}</Text>}
          {provider.bank && <Text style={s.detail}>{provider.bank}</Text>}
          {provider.phone && (
            <Text style={[s.detail, { marginTop: 6 }]}>Тел.: {provider.phone}</Text>
          )}
        </View>
        <View style={s.party}>
          <Text style={s.partyTitle}>
            Замовник: {customer?.company || customer?.name || '________________'}
          </Text>
          {customer?.company && customer.name && <Text style={s.detail}>{customer.name}</Text>}
          {customer?.address && <Text style={s.detail}>Адреса: {customer.address}</Text>}
          {customer?.taxId && <Text style={s.detail}>ЄДРПОУ / РНОКПП: {customer.taxId}</Text>}
          {customer?.phone && (
            <Text style={[s.detail, { marginTop: 6 }]}>Тел.: {customer.phone}</Text>
          )}
        </View>
      </View>
      {data.vehicle && (
        <View style={s.vehicle} wrap={false}>
          <Text>
            Транспортний засіб: {data.vehicle.make}, {data.vehicle.model}, {data.vehicle.year}
          </Text>
          <Text>
            {[
              data.vehicle.licensePlate,
              data.vehicle.vin,
              data.mileage != null ? `${data.mileage.toLocaleString('uk-UA')} км` : null,
            ]
              .filter(Boolean)
              .join(', ')}
          </Text>
        </View>
      )}
      {labor.length > 0 && (
        <Table
          title="Найменування (характеристика) послуг"
          lines={labor}
          currency={unit}
          discounts={discounts}
        />
      )}
      {parts.length > 0 && (
        <Table
          title="Найменування запасних частин, матеріалів і товарів"
          lines={parts}
          parts
          currency={unit}
          discounts={discounts}
        />
      )}
      <View wrap={false} style={{ borderTopWidth: 1, paddingTop: 4 }}>
        {(data.discountAmount ?? 0) > 0 &&
          totalRow(`Знижка, ${unit}:`, money(net(data.discountAmount!)))}
        {totalRow(`Сума без ПДВ, ${unit}:`, money(total - taxAmount), true)}
        {totalRow(`ПДВ, ${unit}:`, taxAmount > 0 ? money(taxAmount) : 'без ПДВ', true)}
        {parseTaxComponents(data.taxComponents)?.map((component, i) => (
          <View key={i}>
            {totalRow(`${component.name} (${component.rate}%), ${unit}:`, money(component.amount))}
          </View>
        ))}
        {totalRow(`Всього до оплати, ${unit}:`, money(total), true)}
        <Text style={s.words}>
          Всього на загальну суму:{' '}
          {currency === 'UAH' ? hryvniaWords(total) : `${money(total)} ${currency}`}
        </Text>
      </View>
      <View style={s.payments}>
        {(paymentSummary?.payments ?? []).map((payment, i) => (
          <View key={i} wrap={false}>
            {totalRow(`Оплачено ${payment.date}`, money(payment.amount))}
          </View>
        ))}
        {paid > recordedPaid && totalRow('Позначено оплаченим', money(paid - recordedPaid))}
        {totalRow(paid > total ? 'Переплата' : 'До сплати', money(Math.abs(total - paid)), true)}
      </View>
      <View style={s.signature} wrap={false}>
        <Text style={s.partyTitle}>Виставив: {signer?.name || ''}</Text>
        {signer?.dataUri && (
          <Image src={signer.dataUri} style={{ width: 110, height: 35, objectFit: 'contain' }} />
        )}
      </View>
      {data.invoiceDueDate && (
        <Text style={{ marginTop: 8 }}>Сплатити до: {date(data.invoiceDueDate)}</Text>
      )}
      {invoiceSettings?.paymentTerms && (
        <Text style={{ marginTop: 6 }}>{invoiceSettings.paymentTerms}</Text>
      )}
      {data.invoiceNotes && (
        <View style={{ marginTop: 8 }}>
          <HtmlToPdf
            html={data.invoiceNotes}
            baseStyle={{ fontSize: 8, color: '#17191d' }}
            fontBold="Roboto-Bold"
          />
        </View>
      )}
      {Object.values(warranty).some(Boolean) && (
        <View style={{ marginTop: 8 }}>
          <Text style={s.bold}>{labels.warranty || 'Гарантія'}</Text>
          {Object.values(warranty)
            .filter(Boolean)
            .map((line, i) => (
              <Text key={i}>{line}</Text>
            ))}
        </View>
      )}
      {data.customFields
        ?.filter((field) => field.value)
        .map((field) => (
          <Text key={field.fieldId} style={{ marginTop: 4 }}>
            {field.label}: {field.value}
          </Text>
        ))}
      {portalUrl && <Text style={{ marginTop: 8 }}>{portalUrl}</Text>}
      {telegramQrDataUri && (
        <Image src={telegramQrDataUri} style={{ width: 50, height: 50, marginTop: 6 }} />
      )}
      {invoiceSettings?.footerNote && (
        <Text style={{ marginTop: 6 }}>{invoiceSettings.footerNote}</Text>
      )}
      {torqvoiceLogoDataUri && (
        <Image
          src={torqvoiceLogoDataUri}
          style={{ width: 65, height: 18, objectFit: 'contain', marginTop: 8 }}
        />
      )}
    </Page>
  )
}
