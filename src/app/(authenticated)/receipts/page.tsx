import { getOperationText } from '@/i18n/operation-text.server'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { settlementAccess } from '@/features/settlements/actions'
import { receiptList, receiptAccess } from '@/features/receipts/actions'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { DocumentHeader, DocumentStatus } from '@/components/operations/document-ui'
import { dayLabel, moneyLabel } from '@/features/finance/presentation'
import { statuses } from '@/features/receipts/status'
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const ot = await getOperationText()

  const p = await searchParams,
    page = Math.max(1, Math.floor(Number(p.page) || 1))
  const labels: Record<string, string> = {
    unverified: ot('Розрахунки не звірено'),
    paid: ot('Оплачено'),
    partial: ot('Частково оплачено'),
    unpaid: ot('Не оплачено'),
    late: ot('Прострочено'),
  }
  const [list, access, finance] = await Promise.all([
    receiptList(p.q || '', p.status || '', p.supplierId || '', p.date || '', page, p.payment),
    receiptAccess(),
    settlementAccess(),
  ])
  if (!list.data) return <p role="alert">{list.error}</p>
  const pageUrl = (n: number) => '/receipts?' + new URLSearchParams({ ...p, page: String(n) })
  return (
    <>
      <DocumentHeader
        title={ot('Надходження')}
        description={ot('Накладні постачальників · товари та послуги')}
        actions={
          <>
            {finance.read && (
              <Button asChild variant="outline">
                <Link href="/mutual-settlements?view=supplier">{ot('Взаєморозрахунки')}</Link>
              </Button>
            )}
            {access.create && (
              <Button asChild>
                <Link href="/receipts/new">
                  <Plus className="size-4" />
                  {ot('Нова накладна')}
                </Link>
              </Button>
            )}
          </>
        }
      />
      <form className="ops-panel grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1fr_auto] [&_label]:grid [&_label]:gap-2 [&_label]:text-sm">
        <label>
          {ot('Номер або постачальник')}
          <Input name="q" placeholder={ot('Знайти накладну…')} defaultValue={p.q} />
        </label>
        <label>
          {ot('Дата приймання')}
          <Input type="date" name="date" defaultValue={p.date} />
        </label>
        {p.supplierId && <input type="hidden" name="supplierId" value={p.supplierId} />}
        <label>
          {ot('Статус')}
          <select
            className="h-10 rounded-md border bg-background px-3"
            name="status"
            defaultValue={p.status}
          >
            <option value="">{ot('Усі')}</option>
            {Object.entries(statuses).map(([k, v]) => (
              <option key={k} value={k}>
                {ot(v)}
              </option>
            ))}
          </select>
        </label>
        {finance.read && (
          <label>
            {ot('Оплата')}
            <select
              className="h-10 rounded-md border bg-background px-3"
              name="payment"
              defaultValue={p.payment}
            >
              <option value="">{ot('Усі')}</option>
              {Object.entries(labels).map(([k, v]) => (
                <option key={k} value={k}>
                  {ot(v)}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex items-center gap-2">
          <Button>{ot('Знайти')}</Button>
          {Object.values(p).some(Boolean) && (
            <Button asChild variant="ghost">
              <Link href="/receipts">{ot('Скинути')}</Link>
            </Button>
          )}
        </div>
      </form>
      <div className="ops-table-scroll">
        <table>
          <thead>
            <tr>
              <th>{ot('Накладна / дата')}</th>
              <th>{ot('Постачальник')}</th>
              <th>{ot('Статус')}</th>
              <th className="text-right">{ot('Сума')}</th>
              {finance.read && (
                <>
                  <th className="text-right">{ot('До сплати')}</th>
                  <th>{ot('Оплата / строк')}</th>
                </>
              )}
              <th>{ot('Дії')}</th>
            </tr>
          </thead>
          <tbody>
            {list.data.slice(0, 50).map((r) => (
              <tr key={r.id}>
                <td>
                  <Link
                    className="font-semibold underline-offset-4 hover:underline"
                    href={'/receipts/' + r.id}
                  >
                    {r.number}
                  </Link>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {dayLabel(r.documentDate)}
                    {r.receivedDate !== r.documentDate &&
                      ot(" · Прийнято ") + dayLabel(r.receivedDate)}
                  </p>
                </td>
                <td>
                  <Link className="hover:underline" href={'/suppliers/' + r.supplierId}>
                    {r.supplier}
                  </Link>
                </td>
                <td>
                  <DocumentStatus
                    tone={
                      r.status === 'posted'
                        ? 'success'
                        : r.status === 'cancelled'
                          ? 'danger'
                          : 'neutral'
                    }
                  >
                    {ot(statuses[r.status])}
                  </DocumentStatus>
                </td>
                <td className="whitespace-nowrap text-right font-medium">{moneyLabel(r.total, ot('грн'))}</td>
                {finance.read && (
                  <>
                    <td className="whitespace-nowrap text-right font-semibold">
                      {r.status === 'posted' && r.open != null ? moneyLabel(r.open, ot('грн')) : '—'}
                    </td>
                    <td>
                      <span className={r.late ? 'text-destructive' : 'text-muted-foreground'}>
                        {ot(labels[r.state])}
                        {r.late && r.state !== 'late' && ot(" · Прострочено")}
                      </span>
                      {r.due && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {ot("До ")}
                          {dayLabel(r.due)}
                        </p>
                      )}
                    </td>
                  </>
                )}
                <td>
                  <Button asChild variant="outline" size="sm">
                    <Link
                      href={
                        '/receipts/' +
                        r.id +
                        (r.status === 'draft' && access.create ? '?edit=1' : '')
                      }
                    >
                      {r.status === 'draft' && access.create ? ot('Редагувати') : ot('Переглянути')}
                    </Link>
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.data.length && (
          <p className="p-12 text-center text-muted-foreground">
            {ot('Накладних за цими умовами немає. Змініть пошук або створіть нову накладну.')}
          </p>
        )}
      </div>
      <nav
        aria-label={ot('Сторінки накладних')}
        className="flex items-center justify-between gap-4"
      >
        <span className="text-sm text-muted-foreground">
          {ot("Сторінка ")}
          {page} {ot(" · Показано ")}
          {Math.min(list.data.length, 50)}
        </span>
        <div className="flex gap-2">
          {page > 1 && (
            <Button asChild variant="outline">
              <Link href={pageUrl(page - 1)}>{ot('Назад')}</Link>
            </Button>
          )}
          {list.data.length > 50 && (
            <Button asChild variant="outline">
              <Link href={pageUrl(page + 1)}>{ot('Далі')}</Link>
            </Button>
          )}
        </div>
      </nav>
    </>
  )
}
