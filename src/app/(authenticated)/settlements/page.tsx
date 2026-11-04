import Link from 'next/link'
import { PageHeader } from '@/components/page-header'
import { settlementAccess, settlementReport } from '@/features/settlements/actions'
import { Account } from '@/features/settlements/Account'
import { hryvnia, kopecks, workshopDay } from '@/features/settlements/amounts'
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const p = await searchParams,
    date = p.date || workshopDay()
  const [r, rights] = await Promise.all([settlementReport(date, p.supplier), settlementAccess()])
  if (!r.data) return <p role="alert">{r.error}</p>
  const accounts = r.data
  const total = (key: 'debt' | 'advance' | 'overdue') =>
    hryvnia(accounts.reduce((s, a) => s + kopecks(a[key]), BigInt(0)))
  return (
    <>
      <PageHeader />
      <main className="space-y-5 overflow-auto p-6">
        <Link className="underline" href="/settlements">
          Усі постачальники
        </Link>
        <h1 className="text-2xl font-semibold">
          {p.supplier
            ? 'Розрахунки · ' + (accounts[0]?.name ?? '')
            : 'Розрахунки з постачальниками'}
        </h1>
        <form className="flex gap-3">
          {p.supplier && <input type="hidden" name="supplier" value={p.supplier} />}
          <label>
            Станом на{' '}
            <input
              className="rounded border p-1"
              type="date"
              name="date"
              defaultValue={date}
              max={workshopDay()}
            />
          </label>
          <button className="underline">Показати</button>
        </form>
        {p.supplier && accounts[0] ? (
          <Account
            account={accounts[0]}
            rights={rights}
            receiptId={p.receipt}
            live={date === workshopDay()}
          />
        ) : (
          <>
            <p>
              До сплати {total('debt')} грн · Прострочено {total('overdue')} грн · Вільні аванси{' '}
              {total('advance')} грн
            </p>
            <table className="w-full text-left">
              <thead>
                <tr>
                  {[
                    'Постачальник',
                    'До сплати, грн',
                    'Прострочено, грн',
                    'Аванси, грн',
                    'До звірки, документів',
                  ].map((t) => (
                    <th key={t}>{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {accounts
                  .filter((a) => !a.isArchived || a.rows.length || a.unknown.length)
                  .map((a) => (
                    <tr key={a.id} className="border-t">
                      <td className="py-2">
                        <Link
                          className="underline"
                          href={'/settlements?' + new URLSearchParams({ supplier: a.id, date })}
                        >
                          {a.name}
                        </Link>
                      </td>
                      <td>{a.debt}</td>
                      <td>{a.overdue}</td>
                      <td>{a.advance}</td>
                      <td>{a.unknown.length}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </>
        )}
      </main>
    </>
  )
}
