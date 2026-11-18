import Link from 'next/link'
import { PageHeader } from '@/components/page-header'
import { DocumentHeader, DocumentStatus } from '@/components/operations/document-ui'
import { Button } from '@/components/ui/button'
import { documentJournal } from '@/features/documents/actions'
import { documentTypes, documentStatus, documentUrl } from '@/features/documents/types'
import { dayLabel, moneyLabel } from '@/features/finance/presentation'
export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const q = await searchParams,
    r = await documentJournal({
      q: q.q || '',
      type: q.type || '',
      from: q.from || '',
      to: q.to || '',
      page: q.page || 1,
    })
  if (!r.data)
    return (
      <>
        <PageHeader />
        <p className="p-6" role="alert">
          {r.error}
        </p>
      </>
    )
  const { rows, total, filters, types } = r.data
  const url = (page: number) => '/documents?' + new URLSearchParams({ ...q, page: String(page) })
  return (
    <>
      <PageHeader />
      <main className="ops-workspace mx-auto w-full max-w-[1440px] space-y-6 p-4 pb-24 sm:p-6 md:pb-6">
        <DocumentHeader
          title="Журнал документів"
          description="Накладні, розрахунки та рух коштів — з переходами до пов’язаних операцій."
        />
        <form className="ops-panel grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[2fr_1.5fr_1fr_1fr_auto] [&_label]:grid [&_label]:min-w-0 [&_label]:gap-2 [&_label]:text-sm [&_input]:h-11 [&_input]:min-w-0 [&_input]:rounded-md [&_input]:border [&_input]:bg-background [&_input]:px-3">
          <label>
            Пошук
            <input
              name="q"
              defaultValue={filters.q}
              placeholder="Номер, контрагент або примітка"
              maxLength={120}
            />
          </label>
          <label>
            Тип документа
            <select
              name="type"
              defaultValue={filters.type}
              className="h-11 min-w-0 rounded-md border bg-background px-3"
            >
              <option value="">Усі доступні</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {documentTypes[t]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Від
            <input type="date" name="from" defaultValue={filters.from} />
          </label>
          <label>
            До
            <input type="date" name="to" defaultValue={filters.to} />
          </label>
          <div className="flex gap-2">
            <Button className="h-11">Показати</Button>
            <Button asChild variant="ghost" className="h-11">
              <Link href="/documents">Скинути</Link>
            </Button>
          </div>
        </form>
        <div className="ops-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Документ</th>
                <th>Контрагент / працівник</th>
                <th>Статус</th>
                <th className="text-right">Сума</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.key}>
                  <td className="whitespace-nowrap">{dayLabel(d.date)}</td>
                  <td>
                    <Link
                      href={documentUrl(d)}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {d.label}
                    </Link>
                    <p className="mt-1 text-xs text-muted-foreground">{documentTypes[d.type]}</p>
                  </td>
                  <td>{d.party || '—'}</td>
                  <td>
                    <DocumentStatus
                      tone={
                        ['posted', 'completed'].includes(d.status)
                          ? 'success'
                          : ['cancelled', 'reversed'].includes(d.status)
                            ? 'danger'
                            : 'neutral'
                      }
                    >
                      {documentStatus[d.status] ?? d.status}
                    </DocumentStatus>
                  </td>
                  <td className="whitespace-nowrap text-right font-semibold">
                    {moneyLabel(d.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <p role="status" className="p-10 text-center text-muted-foreground">
              Документів за цими умовами немає.
            </p>
          )}
        </div>
        <nav
          aria-label="Сторінки журналу"
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <p className="text-sm text-muted-foreground">
            Знайдено: {total} · Сторінка {filters.page} з {Math.max(1, Math.ceil(total / 25))}
          </p>
          <div className="flex gap-2">
            {filters.page > 1 && (
              <Button asChild variant="outline">
                <Link href={url(filters.page - 1)}>Назад</Link>
              </Button>
            )}
            {filters.page * 25 < total && (
              <Button asChild variant="outline">
                <Link href={url(filters.page + 1)}>Далі</Link>
              </Button>
            )}
          </div>
        </nav>
      </main>
    </>
  )
}
