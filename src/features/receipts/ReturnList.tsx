import { getOperationText } from '@/i18n/operation-text.server'
import Link from 'next/link'
import { listSupplierReturns } from './return-actions'
import { moneyLabel, dayLabel } from '@/features/finance/presentation'
export async function ReturnList({
  filters = {},
  paginationHref,
}: {
  filters?: Parameters<typeof listSupplierReturns>[0]
  paginationHref?: string
}) {
  const ot = await getOperationText()

  const r = await listSupplierReturns(filters)
  if (!r.data) return <p role="alert">{r.error}</p>
  function href(page: number) {
    if (paginationHref) {
      const [path, query = ''] = paginationHref.split('?')
      const params = new URLSearchParams(query)
      params.set('returnsPage', String(page))
      return path + '?' + params.toString()
    }
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(filters ?? {}))
      if (value !== undefined && key !== 'page') params.set(key, String(value))
    params.set('page', String(page))
    return '/supplier-returns?' + params.toString()
  }
  return (
    <div className="space-y-4">
      <div className="ops-table-scroll">
        <table>
          <thead>
            <tr>
              <th>{ot('Номер')}</th>
              <th>{ot('Номер документа постачальника')}</th>
              <th>{ot('Дата')}</th>
              <th>{ot('Постачальник')}</th>
              <th>{ot('Статус')}</th>
              <th>{ot('Сума')}</th>
            </tr>
          </thead>
          <tbody>
            {r.data.documents.map((d) => (
              <tr key={d.id}>
                <td>
                  <Link className="underline font-semibold" href={'/supplier-returns/' + d.id}>
                    {d.number}
                  </Link>
                </td>
                <td>{d.supplierDocumentNumber || '—'}</td>
                <td>{dayLabel(d.date)}</td>
                <td>
                  <Link className="underline" href={'/suppliers/' + d.supplierId}>
                    {d.supplier}
                  </Link>
                </td>
                <td>
                  <span className={d.status === 'posted' ? 'text-emerald-500' : 'text-amber-500'}>
                    {d.status === 'posted' ? ot('Проведено') : ot('Чернетка')}
                  </span>
                </td>
                <td className="font-semibold whitespace-nowrap">{moneyLabel(d.amount, ot('грн'))}</td>
              </tr>
            ))}
            {!r.data.documents.length && (
              <tr>
                <td colSpan={6}>{ot('Повернень не знайдено.')}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <nav aria-label={ot('Сторінки повернень')} className="flex flex-wrap items-center gap-4">
        {r.data.page > 1 && (
          <Link className="underline" href={href(r.data.page - 1)}>
            {ot('Назад')}
          </Link>
        )}
        <span>
          {ot("Знайдено: ")}
          {r.data.total} {ot(" · Сторінка ")}
          {r.data.page} {ot(" з ")}
          {r.data.pages}
        </span>
        {r.data.page < r.data.pages && (
          <Link className="underline" href={href(r.data.page + 1)}>
            {ot('Далі')}
          </Link>
        )}
      </nav>
    </div>
  )
}
