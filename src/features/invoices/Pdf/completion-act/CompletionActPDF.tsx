import React from 'react'
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'
import type { InvoiceData } from '@/features/vehicles/Components/invoice-pdf/types'
import { hryvniaWords } from './moneyWords'

export interface CompletionActProps {
  data: InvoiceData
  provider: { name: string; address: string; phone: string; code: string; bank: string }
  logoDataUri?: string
  currency?: string
  timezone?: string
}
const s = StyleSheet.create({
  page: {
    fontFamily: 'Roboto',
    fontSize: 9,
    padding: 30,
    paddingBottom: 38,
    color: '#15191e',
    lineHeight: 1.2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  logo: { width: 165, height: 66, objectFit: 'contain' },
  heading: { width: 320, textAlign: 'right', fontSize: 14, lineHeight: 1.3, fontWeight: 700 },
  parties: { flexDirection: 'row', gap: 22, marginBottom: 10 },
  party: { width: '50%' },
  bold: { fontWeight: 700 },
  small: { fontSize: 8 },
  vehicle: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingVertical: 6,
    marginBottom: 7,
    fontWeight: 700,
    fontSize: 10,
  },
  intro: { fontSize: 8, marginBottom: 9 },
  sectionTitle: { fontWeight: 700, borderTopWidth: 1.3, paddingVertical: 4, fontSize: 9 },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: '#60666c', paddingVertical: 4 },
  tableHead: { backgroundColor: '#eef0f2', fontWeight: 700, borderTopWidth: 0.6 },
  cell: { paddingHorizontal: 3 },
  subtotal: { textAlign: 'right', fontWeight: 700, marginTop: 5, marginBottom: 10 },
  totals: { alignItems: 'flex-end', borderTopWidth: 1, paddingTop: 5, marginBottom: 10 },
  totalRow: { flexDirection: 'row', width: 265, justifyContent: 'space-between', marginBottom: 3 },
  words: { fontWeight: 700, marginBottom: 12 },
  acceptance: { fontSize: 9, marginBottom: 15, fontWeight: 700 },
  signature: { width: '47%', borderBottomWidth: 0.8, minHeight: 48 },
  footer: {
    position: 'absolute',
    bottom: 19,
    height: 12,
    left: 30,
    right: 30,
    textAlign: 'right',
    fontSize: 7,
    color: '#666',
  },
})
const money = (value: number) =>
  value.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
type Line = { name: string; unit: string; quantity: number; price: number; total: number }
function Lines({
  title,
  lines,
  currency,
  taxed,
}: {
  title: string
  lines: Line[]
  currency: string
  taxed: boolean
}) {
  const widths = ['5%', '49%', '7%', '11%', '14%', '14%']
  return (
    <View>
      <View minPresenceAhead={50}>
        <Text style={s.sectionTitle}>{title}</Text>
        <View style={[s.row, s.tableHead]}>
          {[
            '№',
            'Назва',
            'Од.',
            'Кількість',
            taxed ? 'Ціна, грн' : 'Ціна без ПДВ',
            taxed ? 'Сума, грн' : 'Сума без ПДВ',
          ].map((v, i) => (
            <Text
              key={i}
              style={[s.cell, { width: widths[i], textAlign: i > 2 ? 'right' : 'left' }]}
            >
              {v.replace('грн', currency)}
            </Text>
          ))}
        </View>
      </View>
      {lines.map((line, i) => (
        <View style={s.row} key={i} wrap={false}>
          {[
            String(i + 1),
            line.name,
            line.unit,
            money(line.quantity),
            money(line.price),
            money(line.total),
          ].map((v, j) => (
            <Text
              key={j}
              style={[s.cell, { width: widths[j], textAlign: j > 2 ? 'right' : 'left' }]}
            >
              {v}
            </Text>
          ))}
        </View>
      ))}
      {!lines.length && <Text style={{ padding: 5 }}>Не зазначено</Text>}
      <Text style={s.subtotal}>
        Разом: {money(lines.reduce((sum, line) => sum + line.total, 0))} {currency}
      </Text>
    </View>
  )
}
export function CompletionActPDF({
  data,
  provider,
  logoDataUri,
  currency = 'UAH',
  timezone = 'Europe/Kyiv',
}: CompletionActProps) {
  const customer = data.customer ?? data.vehicle?.customer
  const vehicle = data.vehicle
  const number = data.invoiceNumber || data.id
  const date = new Intl.DateTimeFormat('uk-UA', { timeZone: timezone }).format(
    new Date(data.invoiceDate ?? data.serviceDate)
  )
  const unit = currency === 'UAH' ? 'грн' : currency
  const labor = data.laborItems.map((l) => ({
    name: l.description,
    unit: l.pricingType === 'service' ? 'посл.' : 'н/год',
    quantity: l.hours,
    price: l.rate,
    total: l.total,
  }))
  const parts = data.partItems.map((p) => ({
    name: p.name + (p.partNumber ? ` (арт. ${p.partNumber})` : ''),
    unit: p.unit || 'шт',
    quantity: p.quantity,
    price: p.unitPrice,
    total: p.total,
  }))
  const discount = data.discountAmount ?? 0
  const taxed = data.taxAmount > 0
  return (
    <Document title={`Акт наданих послуг № ${number}`} author={provider.name}>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          {logoDataUri ? (
            <Image src={logoDataUri} style={s.logo} />
          ) : (
            <Text style={{ fontSize: 23, fontWeight: 700 }}>L’AUTO</Text>
          )}
          <Text style={s.heading}>
            Акт приймання-передачі наданих послуг{'\n'}№ {number}
            {'\n'}від {date}
          </Text>
        </View>
        <View style={s.parties} wrap={false}>
          <View style={s.party}>
            <Text style={[s.bold, { marginBottom: 5 }]}>Виконавець: {provider.name}</Text>
            {provider.address && <Text>Адреса: {provider.address}</Text>}
            {provider.code && <Text>Код ЄДРПОУ / РНОКПП: {provider.code}</Text>}
            {provider.bank && <Text>{provider.bank}</Text>}
            {provider.phone && <Text>Тел.: {provider.phone}</Text>}
          </View>
          <View style={s.party}>
            <Text style={[s.bold, { marginBottom: 5 }]}>
              Замовник: {customer?.company || customer?.name || '________________________'}
            </Text>
            {customer?.company && customer.name && <Text>{customer.name}</Text>}
            {customer?.address && <Text>Адреса: {customer.address}</Text>}
            {customer?.taxId && <Text>Код ЄДРПОУ / РНОКПП: {customer.taxId}</Text>}
            {customer?.phone && <Text>Тел.: {customer.phone}</Text>}
          </View>
        </View>
        {vehicle && (
          <View style={s.vehicle} wrap={false}>
            <Text>
              Транспортний засіб: {vehicle.make}, {vehicle.model}, {vehicle.year}
            </Text>
            <Text>
              {[
                vehicle.licensePlate,
                vehicle.vin,
                data.mileage != null ? `${data.mileage.toLocaleString('uk-UA')} км` : null,
              ]
                .filter(Boolean)
                .join(', ')}
            </Text>
          </View>
        )}
        <Text style={s.intro}>
          Ми, що нижче підписалися, представник Виконавця і представник Замовника, уклали цей акт
          про те, що Виконавець виконав роботи (надав послуги) згідно з нарядом-замовленням №{' '}
          {number} від {date} та договором № __________________ від ______________.
        </Text>
        <Lines
          title="Найменування (характеристика) послуг"
          lines={labor}
          currency={unit}
          taxed={taxed}
        />
        <Lines
          title="Запасні частини, матеріали й товари, використані для ремонту"
          lines={parts}
          currency={unit}
          taxed={taxed}
        />
        <View wrap={false}>
          <View style={s.totals}>
            {discount > 0 && (
              <View style={s.totalRow}>
                <Text>Знижка:</Text>
                <Text>
                  {money(discount)} {unit}
                </Text>
              </View>
            )}
            <View style={s.totalRow}>
              <Text>Сума без ПДВ:</Text>
              <Text>
                {money(data.totalAmount - data.taxAmount)} {unit}
              </Text>
            </View>
            <View style={s.totalRow}>
              <Text>ПДВ:</Text>
              <Text>{taxed ? `${money(data.taxAmount)} ${unit}` : 'без ПДВ'}</Text>
            </View>
            <View style={[s.totalRow, s.bold]}>
              <Text>Загальна сума:</Text>
              <Text>
                {money(data.totalAmount)} {unit}
              </Text>
            </View>
          </View>
          <Text style={s.words}>
            Всього на загальну суму:{' '}
            {currency === 'UAH'
              ? hryvniaWords(data.totalAmount)
              : `${money(data.totalAmount)} ${currency}`}
          </Text>
          <Text style={[s.intro, { borderTopWidth: 0.7, paddingTop: 6 }]}>
            Цей акт є підставою для оплати. Замовник зобов’язаний сплатити Виконавцю визначену в
            цьому акті вартість наданих послуг та використаних запасних частин (матеріалів, товарів)
            протягом 3-х робочих днів з дати підписання цього акта.
          </Text>
          <Text style={s.acceptance}>
            Даним підписом підтверджую отримання наданих послуг. Претензій до Виконавця щодо обсягу
            робіт, зовнішнього вигляду та комплектації транспортного засобу не маю.
          </Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View style={s.signature}>
              <Text style={s.bold}>Виконавець:</Text>
              <Text style={s.small}>{provider.name}</Text>
            </View>
            <View style={s.signature}>
              <Text style={s.bold}>Замовник:</Text>
              <Text style={s.small}>{customer?.name || ''}</Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  )
}
