import { getOperationText } from '@/i18n/operation-text.server'
import { redirect } from 'next/navigation'
import { DocumentHeader } from '@/components/operations/document-ui'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { settlementAccess, settlementReport } from '@/features/settlements/actions'
import { Account } from '@/features/settlements/Account'
import { workshopDay } from '@/features/settlements/amounts'

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const ot = await getOperationText()

  const p = await searchParams,
    date = p.date || workshopDay()
  if (!p.supplier)
    redirect('/mutual-settlements?' + new URLSearchParams({ view: 'supplier', date }))
  const [r, rights] = await Promise.all([settlementReport(date, p.supplier), settlementAccess()])
  if (!r.data) return <p role="alert">{r.error}</p>
  const account = r.data[0]
  return (
    <>
      <PageHeader />
      <main className="ops-workspace mx-auto w-full max-w-7xl space-y-6 overflow-auto p-4 sm:p-6">
        <DocumentHeader
          title={ot("Розрахунки · ") + (account?.name ?? ot('Постачальник'))}
          back={{ href: '/suppliers/' + p.supplier, label: ot('Картка постачальника') }}
        />
        <form className="ops-form ops-panel max-w-xl">
          <input type="hidden" name="supplier" value={p.supplier} />
          {p.receipt && <input type="hidden" name="receipt" value={p.receipt} />}
          <label>
            {ot('Станом на')}
            <input type="date" name="date" defaultValue={date} max={workshopDay()} required />
          </label>
          <Button variant="outline">{ot('Показати')}</Button>
        </form>
        {account ? (
          <Account
            account={account}
            rights={rights}
            receiptId={p.receipt}
            live={date === workshopDay()}
          />
        ) : (
          <p className="ops-panel" role="status">
            {ot('Немає даних для цього постачальника.')}
          </p>
        )}
      </main>
    </>
  )
}
