import {receiptAccess} from '@/features/receipts/actions'
import {settlementAccess} from '@/features/settlements/actions'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { getSupplier, getSupplierCapabilities } from '@/features/suppliers/Actions/supplierActions'
import { ArchiveSupplier } from '@/features/suppliers/Components/ArchiveSupplier'
export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [r, cap, t] = await Promise.all([
    getSupplier(id),
    getSupplierCapabilities(),
    getTranslations('suppliers'),
  ])
  if (!r.data)
    return (
      <>
        <PageHeader />
        <p role="alert" className="p-6">
          {r.error}
        </p>
      </>
    )
  const { supplier: s, history } = r.data
  const [receipts,finance]=await Promise.all([receiptAccess(),settlementAccess()])
  return (
    <>
      <PageHeader />
      <main className="space-y-6 p-6">
        <div className="flex flex-wrap items-center gap-4">
          <h1 className="text-2xl font-semibold">{s.name}</h1>
          {s.isArchived && <span>{t('archived')}</span>}
          {cap.data?.update && (
            <Link className="underline" href={'/suppliers/' + id + '/edit'}>
              {t('edit')}
            </Link>
          )}
          {cap.data?.archive && <ArchiveSupplier id={id} archived={s.isArchived} />}
        </div>
         {receipts.read?<Link className="underline" href={'/receipts?supplierId='+id}>Накладні постачальника</Link>:<p className="text-muted-foreground">{t('sourceOnly')}</p>}
        {finance.read&&<Link className="underline" href={'/settlements?supplier='+id}>Розрахунки та оплати</Link>}
        <dl className="grid max-w-4xl gap-4 sm:grid-cols-2">
          {(['legalName', 'kind', 'country', 'taxId', 'address', 'website', 'notes'] as const).map(
            (k) => (
              <div key={k}>
                <dt className="text-sm text-muted-foreground">{t(k)}</dt>
                <dd className="whitespace-pre-wrap break-words">
                  {k === 'kind' ? t(s.kind) : s[k] || '—'}
                </dd>
              </div>
            )
          )}
          <div>
            <dt>{t('paymentTermDays')}</dt>
            <dd>{s.supplierProfile?.paymentTermDays ?? t('unknown')}</dd>
          </div>
          <div>
            <dt>{t('paymentTerms')}</dt>
            <dd>{s.supplierProfile?.paymentTerms || '—'}</dd>
          </div>
        </dl>
        <section>
          <h2 className="mb-2 font-semibold">{t('contacts')}</h2>
          {s.contacts.map((c) => (
            <div className="mb-2 rounded border p-3" key={c.id}>
              {c.name} {c.role} {c.isPrimary && '★'}
              <p>
                {c.phone} {c.email}
              </p>
            </div>
          ))}
        </section>
        <section>
          <h2 className="mb-2 font-semibold">{t('bankAccounts')}</h2>
          {s.bankAccounts.map((b) => (
            <p key={b.id} className="break-all">
              {b.accountNumber} · {b.bankName} · {b.currency} {b.isPrimary && '★'}
            </p>
          ))}
        </section>
        <section>
          <h2 className="mb-2 font-semibold">{t('linkedParts')}</h2>
          {s.preferredParts.map((p) => (
            <p key={p.id}>
              <Link className="underline" href={'/inventory/' + p.id}>
                {p.name} {p.partNumber}
              </Link>
            </p>
          ))}
        </section>
        <section>
          <h2 className="font-semibold">{t('source')}</h2>
          {s.sourceLinks.map((l) => (
            <p key={l.id}>
              {l.source} / {l.externalSupplierId} · {t('snapshot')}: {l.snapshotAt.toISOString()} ·{' '}
              {t('lastActivity')}: {l.lastActivityAt?.toISOString() ?? '—'}
            </p>
          ))}
        </section>
        <section>
          <h2 className="font-semibold">{t('history')}</h2>
          {history.map((h) => (
            <p key={h.id}>
              {h.timestamp.toISOString()} · {h.action}
            </p>
          ))}
        </section>
      </main>
    </>
  )
}
