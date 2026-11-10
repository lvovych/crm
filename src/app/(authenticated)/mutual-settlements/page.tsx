import Link from 'next/link'
import { PageHeader } from '@/components/page-header'
import { mutualSettlementsReport } from '@/features/mutual-settlements/actions'
import { OverviewClient } from '@/features/mutual-settlements/OverviewClient'
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string }>
}) {
  const p = await searchParams
  const result = await mutualSettlementsReport(p.date)
  return (
    <>
      <PageHeader />
      <main className="min-h-0 flex-1 overflow-y-auto">
        {result.success && result.data ? (
          <OverviewClient key={result.data.asOf} data={result.data} initialView={p.view} />
        ) : (
          <div className="space-y-3 p-6" role="alert">
            <h1 className="text-2xl font-semibold">Взаєморозрахунки</h1>
            <p>{result.error || 'Не вдалося завантажити дані.'}</p>
            <Link className="underline" href="/mutual-settlements">
              Повернутися до огляду на сьогодні
            </Link>
          </div>
        )}
      </main>
    </>
  )
}
