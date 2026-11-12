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
  searchParams: Promise<{ edit?: string }>
}) {
  const { id } = await params
  const [r, access, p] = await Promise.all([receiptDetail(id), receiptAccess(), searchParams])
  if (!r.data) return <p role="alert">{r.error}</p>
  const d = r.data
  if (d.status === 'draft' && p.edit && access.create) {
    const o = await receiptOptions()
    if (o.data)
      return (
        <>
          <h1>Редагування чернетки {d.number}</h1>
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
  const account =
    rights.read && d.status === 'posted'
      ? (await settlementReport(workshopDay(), d.supplierId)).data?.[0]
      : null
  return (
    <>
      <section className="rounded-xl border-2 border-border bg-muted/30 p-5 space-y-3">
        <h1 className="text-2xl font-semibold">Накладна № {d.number}</h1>
        <p>
          {statuses[d.status]} ·{' '}
          <Link className="underline" href={'/suppliers/' + d.supplierId}>
            {d.supplier.name}
          </Link>
        </p>
        <p>
          Дата документа {d.documentDate} · Дата приймання {d.receivedDate}
        </p>
      </section>
      <section className="rounded-xl border-2 border-border p-5 space-y-4">
        <h2 className="text-lg font-semibold">Товари та послуги</h2>
        <div className="overflow-auto">
          <table className="w-full text-left [&_td]:px-2 [&_td]:py-3 [&_td]:whitespace-nowrap">
            <thead className="bg-muted">
              <tr>
                {['Позиція', 'Артикул', 'Бренд', 'Тип', 'Кількість', 'Ціна, грн', 'Сума, грн'].map(
                  (s) => (
                    <th className="px-2 py-3" key={s}>
                      {s}
                    </th>
                  )
                )}
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
                  <td>{l.kind === 'part' ? 'Запчастина' : 'Послуга'}</td>
                  <td>
                    {l.quantity} {l.unit}
                  </td>
                  <td>{l.unitPrice}</td>
                  <td>{l.amount}
                    {transfers && l.kind === 'service' && (l.subcontract ? <p>Віднесено на наряд</p> : <AssignService lineId={l.id} orders={transfers.orders} />)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xl font-semibold">Разом {receiptTotal(d.lines)} грн</p>
      </section>
      {transfers && <TransferGoods receiptId={id} data={transfers} />}
      {account && (
        <section className="rounded-xl border-2 border-border bg-muted/30 p-5 space-y-4">
          <h2 className="font-semibold">Оплата накладної</h2>
          <Account account={account} rights={rights} receiptId={id} live />
        </section>
      )}
      <p>Створено · {d.creator}</p>
      {d.postedAt && (
        <p>
          Проведено · {d.poster} · {d.postedAt.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' })}
        </p>
      )}
      {d.cancelledAt && (
        <p>
          Скасовано · {d.canceller} ·{' '}
          {d.cancelledAt.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' })} · {d.cancelReason}
        </p>
      )}
      {d.status === 'draft' && access.create && (
        <Link className="underline" href={'/receipts/' + id + '?edit=1'}>
          Редагувати чернетку
        </Link>
      )}
      {((access.post && d.status === 'draft') || (access.cancel && d.status === 'posted')) && (
        <Transition id={id} version={d.version} posting={d.status === 'draft'} />
      )}
    </>
  )
}
