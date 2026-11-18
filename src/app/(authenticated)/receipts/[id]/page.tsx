import { getOperationText } from '@/i18n/operation-text.server'
import { Suspense } from 'react'
import { RelatedDocuments } from '@/features/documents/RelatedDocuments'
import { DocumentHeader, DocumentStatus, MoneySummary } from '@/components/operations/document-ui'
import { DocumentTabs } from '@/components/operations/document-tabs'
import { Button } from '@/components/ui/button'
import { dayLabel, moneyLabel, unitPriceLabel } from '@/features/finance/presentation'
import { Returns } from '@/features/receipts/Returns'
import { supplierReturnData } from '@/features/receipts/return-actions'
import { AssignService } from '@/features/receipts/AssignService'
import { TransferGoods } from '@/features/receipts/TransferGoods'
import { receiptTransferOptions } from '@/features/receipts/transfer-actions'
import { Account } from '@/features/settlements/Account'
import { workshopDay } from '@/features/settlements/amounts'
import { settlementAccess, settlementReport } from '@/features/settlements/actions'
import Link from 'next/link'
import { receiptOptions, receiptDetail, receiptAccess } from '@/features/receipts/actions'
import ReceiptForm from '@/features/receipts/ReceiptForm'
import { Transition } from '@/features/receipts/Transition'
import { statuses } from '@/features/receipts/status'
import { receiptTotal } from '@/features/receipts/money'
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ edit?: string; tab?: string }>
}) {
  const ot = await getOperationText()

  const { id } = await params
  const [r, access, p] = await Promise.all([receiptDetail(id), receiptAccess(), searchParams])
  if (!r.data) return <p role="alert">{r.error}</p>
  const d = r.data
  if (d.status === 'draft' && p.edit && access.create) {
    const o = await receiptOptions()
    if (o.data)
      return (
        <>
          <h1>
            {ot("Редагування чернетки ")}
            {d.number}
          </h1>
          <ReceiptForm
            options={o.data}
            canPost={access.post}
            initial={{
              ...d,
              lines: d.lines.map((l) => ({
                ...l,
                article: l.article ?? '',
                kind: l.kind === 'service' ? 'service' : 'part',
              })),
            }}
          />
        </>
      )
  }
  const transfers = d.status === 'posted' ? (await receiptTransferOptions(id)).data : null
  const rights = await settlementAccess()
  const returns = await supplierReturnData(id)
  const account =
    rights.read && d.status === 'posted'
      ? (await settlementReport(workshopDay(), d.supplierId)).data?.[0]
      : null
  const entry = account?.rows.find((row) => row.receiptId === id && row.active)
  return (
    <>
      <DocumentHeader
        title={ot("Накладна № ") + d.number}
        back={{ href: '/receipts', label: ot('Надходження') }}
        status={
          <DocumentStatus
            tone={
              d.status === 'posted' ? 'success' : d.status === 'cancelled' ? 'danger' : 'neutral'
            }
          >
            {ot(statuses[d.status])}
          </DocumentStatus>
        }
        description={
          <>
            <Link
              className="font-medium text-foreground underline-offset-4 hover:underline"
              href={'/suppliers/' + d.supplierId}
            >
              {d.supplier.name}
            </Link>
            <span className="mx-2">·</span>
            {ot("Документ ")}
            {dayLabel(d.documentDate)}
            <span className="mx-2">·</span>
            {ot("Прийнято ")}
            {dayLabel(d.receivedDate)}
          </>
        }
        actions={
          d.status === 'draft' ? (
            <>
              {access.create && (
                <Button asChild variant="outline">
                  <Link href={'/receipts/' + id + '?edit=1'}>{ot('Редагувати накладну')}</Link>
                </Button>
              )}
              {access.post && <Transition id={id} version={d.version} posting />}
            </>
          ) : undefined
        }
      />
      <MoneySummary
        items={[
          { label: ot('Сума накладної'), value: receiptTotal(d.lines) },
          ...(entry
            ? [
                {
                  label: ot('До сплати за накладною'),
                  value: entry.open,
                  emphasis: true,
                  hint:
                    Number(entry.open) > 0
                      ? entry.due
                        ? ot("Сплатити до ") + dayLabel(entry.due)
                        : ot('Строк не вказано')
                      : ot('Заборгованості немає'),
                },
              ]
            : []),
        ]}
      />
      <DocumentTabs
        initial={p.tab}
        tabs={[
          {
            id: 'items',
            label: ot('Товари та послуги'),
            content: (
              <>
                <section className="ops-panel space-y-4">
                  <h2 className="text-lg font-semibold">{ot('Товари та послуги')}</h2>
                  <div className="ops-table-scroll">
                    <table className="w-full text-left [&_td]:px-2 [&_td]:py-3 [&_td]:whitespace-nowrap">
                      <thead className="bg-muted">
                        <tr>
                          {[
                            ot('Позиція'),
                            ot('Артикул'),
                            ot('Бренд'),
                            ot('Тип'),
                            ot('Кількість'),
                            ot('Ціна, грн'),
                            ot('Сума, грн'),
                          ].map((s) => (
                            <th className="px-2 py-3" key={s}>
                              {s}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {d.lines.map((l) => (
                          <tr className="border-t" key={l.id}>
                            <td className="py-2">
                              {l.partId ? (
                                <Link className="underline" href={'/inventory/' + l.partId}>
                                  {l.name}
                                </Link>
                              ) : (
                                l.name
                              )}
                            </td>
                            <td>{l.article || '—'}</td>
                            <td>{l.part?.brand.name || '—'}</td>
                            <td>{l.kind === 'part' ? ot('Запчастина') : ot('Послуга')}</td>
                            <td>
                              {l.quantity} {l.unit}
                            </td>
                            <td className="text-right">{unitPriceLabel(l.unitPrice)}</td>
                            <td className="text-right">
                              {moneyLabel(l.amount, ot('грн'))}
                              {transfers &&
                                l.kind === 'service' &&
                                (l.subcontract ? (
                                  <p>{ot('Віднесено на наряд')}</p>
                                ) : (
                                  <AssignService lineId={l.id} orders={transfers.serviceOrders} />
                                ))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xl font-semibold">
                    {ot("Разом ")}
                    {moneyLabel(receiptTotal(d.lines), ot('грн'))}
                  </p>
                </section>
              </>
            ),
          },
          ...(account
            ? [
                {
                  id: 'payments',
                  label: ot('Оплати й розрахунки'),
                  content: <Account account={account} rights={rights} receiptId={id} live={true} />,
                },
              ]
            : []),
          ...(transfers
            ? [
                {
                  id: 'transfer',
                  label: ot('Передати в наряд'),
                  content: <TransferGoods receiptId={id} data={transfers} />,
                },
              ]
            : []),
          ...(returns.data
            ? [
                {
                  id: 'returns',
                  label:
                    ot('Повернення') +
                    (returns.data.documents.length ? ' · ' + returns.data.documents.length : ''),
                  content: (
                    <Returns
                      receiptId={id}
                      data={returns.data}
                      canCreate={access.create && access.post && rights.create}
                    />
                  ),
                },
              ]
            : []),
          {
            id: 'connections',
            label: ot('Пов’язані документи'),
            content: (
              <Suspense
                fallback={
                  <p role="status" className="ops-panel">
                    {ot('Завантаження пов’язаних документів…')}
                  </p>
                }
              >
                <RelatedDocuments type="receipt" id={id} />
              </Suspense>
            ),
          },
        ]}
      />
      <details className="ops-panel text-sm text-muted-foreground">
        <summary>{ot('Історія та дії з документом')}</summary>
        <div className="space-y-3 pt-3">
          <p>
            {ot("Створено · ")}
            {d.creator}
          </p>
          {d.postedAt && (
            <p>
              {ot("Проведено · ")}
              {d.poster} · {d.postedAt.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' })}
            </p>
          )}
          {d.cancelledAt && (
            <p>
              {ot("Скасовано · ")}
              {d.canceller} · {d.cancelledAt.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' })} ·{' '}
              {d.cancelReason}
            </p>
          )}
          {d.status === 'draft' && access.create && (
            <Link className="underline" href={'/receipts/' + id + '?edit=1'}>
              {ot('Редагувати чернетку')}
            </Link>
          )}
          {access.cancel && d.status === 'posted' && (
            <Transition id={id} version={d.version} posting={false} />
          )}
        </div>
      </details>
    </>
  )
}
