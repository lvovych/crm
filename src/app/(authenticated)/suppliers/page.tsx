import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { ListPage } from '@/components/list-page'
import {
  listSuppliers,
  getSupplierCapabilities,
} from '@/features/suppliers/Actions/supplierActions'
export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const p = await searchParams
  const [result, cap, t] = await Promise.all([
    listSuppliers(p),
    getSupplierCapabilities(),
    getTranslations('suppliers'),
  ])
  if (!result.success || !result.data)
    return (
      <>
        <PageHeader />
        <p role="alert" className="p-6">
          {result.error}
        </p>
      </>
    )
  const { items, total, page } = result.data
  const pageUrl = (n: number) =>
    '/suppliers?' +
    new URLSearchParams({
      ...Object.fromEntries(
        Object.entries(p).filter(
          (v): v is [string, string] => v[1] !== undefined && v[0] !== 'type'
        )
      ),
      page: String(n),
    }).toString()
  return (
    <>
      <PageHeader />
      <ListPage>
        <div className="flex min-h-0 flex-1 flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold">{t('title')}</h1>
            <div className="flex flex-wrap gap-4">
              {cap.data?.import && (
                <Link className="underline" href="/suppliers/import">
                  {t('importTitle')}
                </Link>
              )}
              {cap.data?.create && (
                <Link className="underline" href="/suppliers/new">
                  {t('new')}
                </Link>
              )}
            </div>
          </div>
          <form className="flex shrink-0 flex-wrap gap-3">
            <input
              aria-label={t('search')}
              name="search"
              defaultValue={p.search}
              placeholder={t('search')}
              className="rounded-md border bg-background px-3 py-2 min-w-64"
            />
            <select
              aria-label={t('status')}
              name="archived"
              defaultValue={p.archived ?? 'active'}
              className="rounded-md border bg-background p-2"
            >
              {['active', 'archived', 'all'].map((v) => (
                <option key={v} value={v}>
                  {t(v)}
                </option>
              ))}
            </select>
            <select
              aria-label={t('source')}
              name="source"
              defaultValue={p.source ?? 'all'}
              className="rounded-md border bg-background p-2"
            >
              <option value="all">{t('all')}</option>
              <option value="carbook">Carbook</option>
              <option value="manual">{t('manual')}</option>
            </select>
            <button className="rounded-md border px-4 py-2">{t('choose')}</button>
          </form>
          <p className="text-sm text-muted-foreground">{t('total', { count: total })}</p>
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b text-left">
                  {['name', 'phone', 'email', 'taxId', 'paymentTermDays', 'lastActivity'].map(
                    (k) => (
                      <th key={k} className="whitespace-nowrap p-3">
                        {t(k)}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {items.map((s) => {
                  const c = s.contacts.find((c) => c.isPrimary) ?? s.contacts[0]
                  const last = s.sourceLinks
                    .map((l) => l.lastActivityAt)
                    .filter((d): d is Date => !!d)
                    .sort((a, b) => b.getTime() - a.getTime())[0]
                  return (
                    <tr key={s.id} className="border-b">
                      <td className="p-3">
                        <Link className="underline" href={'/suppliers/' + s.id}>
                          {s.name}
                        </Link>
                        {s.isArchived && (
                          <span className="ml-2 text-muted-foreground">{t('archived')}</span>
                        )}
                      </td>
                      <td className="p-3">{c?.phone || '—'}</td>
                      <td className="p-3">{c?.email || '—'}</td>
                      <td className="p-3">{s.taxId || '—'}</td>
                      <td className="p-3">{s.supplierProfile?.paymentTermDays ?? '—'}</td>
                      <td className="p-3">{last?.toISOString().slice(0, 10) || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {!items.length && <p className="p-6">{t('empty')}</p>}
          </div>
          <nav className="flex shrink-0 flex-wrap gap-4">
            {page > 1 && <Link href={pageUrl(page - 1)}>{t('previous')}</Link>}
            {page * 25 < total && <Link href={pageUrl(page + 1)}>{t('next')}</Link>}
          </nav>
        </div>
      </ListPage>
    </>
  )
}
