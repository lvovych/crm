import Link from 'next/link'
import { listSupplierReturns } from './return-actions'
import { moneyLabel, dayLabel } from '@/features/finance/presentation'
import { receiptTotal } from './money'
export async function ReturnList({
  filters = {},
}: {
  filters?: Parameters<typeof listSupplierReturns>[0]
}) {
  const r = await listSupplierReturns(filters)
  if (!r.data) return <p role="alert">{r.error}</p>
  return (
    <div className="ops-table-scroll">
      <table>
        <thead>
          <tr>
            <th>Номер</th>
            <th>Номер документа постачальника</th>
            <th>Дата</th>
            <th>Постачальник</th>
            <th>Статус</th>
            <th>Сума</th>
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
                  {d.status === 'posted' ? 'Проведено' : 'Чернетка'}
                </span>
              </td>
              <td className="font-semibold whitespace-nowrap">
                {moneyLabel(receiptTotal(d.lines))}
              </td>
            </tr>
          ))}
          {!r.data.documents.length && (
            <tr>
              <td colSpan={6}>Повернень не знайдено.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
