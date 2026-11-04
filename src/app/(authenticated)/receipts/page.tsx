import { Transition } from '@/features/receipts/Transition'
import Link from 'next/link'
import { receiptList, receiptAccess } from '@/features/receipts/actions'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { statuses } from '@/features/receipts/status'
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const p = await searchParams,
    page = Math.max(1, Math.floor(Number(p.page) || 1))
  const [list, access] = await Promise.all([
    receiptList(p.q || '', p.status || '', p.supplierId || '', p.date || '', page),
    receiptAccess(),
  ])
  if (!list.data) return <p role="alert">{list.error}</p>
  const pageUrl = (n: number) => '/receipts?' + new URLSearchParams({ ...p, page: String(n) })
  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Надходження</h1>
        {access.create && (
          <Link className="underline" href="/receipts/new">
            Нова накладна
          </Link>
        )}
      </div>
      <form className="flex flex-wrap items-end gap-3">
        <label>
          Номер або постачальник
          <Input name="q" defaultValue={p.q} />
        </label>
        <label>
          Дата приймання
          <Input type="date" name="date" defaultValue={p.date} />
        </label>
        {p.supplierId && <input type="hidden" name="supplierId" value={p.supplierId} />}
        <label>
          Статус
          <select
            className="block rounded border bg-background p-2"
            name="status"
            defaultValue={p.status}
          >
            <option value="">Усі</option>
            {Object.entries(statuses).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <Button>Знайти</Button>
      </form>
      <div className="overflow-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              {[
                'Номер',
                'Постачальник',
                'Дата документа',
                'Дата приймання',
                'Статус',
                'Сума, грн',
                'Дії',
              ].map((s) => (
                <th className="p-2" key={s}>
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.data.slice(0, 50).map((r) => (
              <tr className="border-t" key={r.id}>
                <td className="p-2">
                  <Link className="underline" href={'/receipts/' + r.id}>
                    {r.number}
                  </Link>
                </td>
                <td>{r.supplier}</td>
                <td>{r.documentDate}</td>
                <td>{r.receivedDate}</td>
                <td>{statuses[r.status]}</td>
                <td>{r.total}</td>
                <td className="p-2">
                  <div className="flex items-center gap-3">
                    <Link
                      className="underline"
                      href={
                        '/receipts/' +
                        r.id +
                        (r.status === 'draft' && access.create ? '?edit=1' : '')
                      }
                    >
                      {r.status === 'draft' && access.create ? 'Редагувати' : 'Переглянути'}
                    </Link>
                    {r.status === 'draft' && access.post && (
                      <Transition id={r.id} version={r.version} posting />
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!list.data.length && <p>Накладних за цими умовами ще немає.</p>}
      <nav className="flex gap-4">
        {page > 1 && <Link href={pageUrl(page - 1)}>Назад</Link>}
        {list.data.length > 50 && <Link href={pageUrl(page + 1)}>Далі</Link>}
      </nav>
    </>
  )
}
