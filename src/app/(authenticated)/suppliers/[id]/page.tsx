import { DocumentHeader, DocumentStatus } from '@/components/operations/document-ui'
import { DocumentTabs } from '@/components/operations/document-tabs'
import { Button } from '@/components/ui/button'
import { PartyDocuments } from '@/features/mutual-settlements/PartyDocuments'
import { receiptAccess } from '@/features/receipts/actions'
import { settlementAccess } from '@/features/settlements/actions'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { getSupplier, getSupplierCapabilities } from '@/features/suppliers/Actions/supplierActions'
import { ArchiveSupplier } from '@/features/suppliers/Components/ArchiveSupplier'
export default async function SupplierPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ date?: string }>
}) {
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
  const [receipts, finance] = await Promise.all([receiptAccess(), settlementAccess()])
  return (
    <>
      <PageHeader />
      <main className="ops-workspace mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6">
        <DocumentHeader
          title={s.name}
          back={{ href: '/suppliers', label: 'Постачальники' }}
          status={s.isArchived ? <DocumentStatus>{t('archived')}</DocumentStatus> : undefined}
          actions={
            <>
              {receipts.read && (
                <Button asChild variant="outline">
                  <Link href={'/receipts?supplierId=' + id}>Накладні</Link>
                </Button>
              )}
              {finance.read && (
                <Button asChild>
                  <Link href={'/settlements?supplier=' + id}>Оплата й розрахунки</Link>
                </Button>
              )}
              {cap.data?.update && (
                <Button asChild variant="outline">
                  <Link href={'/suppliers/' + id + '/edit'}>{t('edit')}</Link>
                </Button>
              )}
            </>
          }
        />
        <DocumentTabs
          tabs={[
            ...(finance.read
              ? [
                  {
                    id: 'documents',
                    label: 'Документи взаєморозрахунків',
                    content: (
                      <PartyDocuments kind="supplier" id={id} date={(await searchParams).date} />
                    ),
                  },
                ]
              : []),
            {
              id: 'profile',
              label: 'Реквізити й контакти',
              content: (
                <div className="ops-panel space-y-6">
                  <dl className="grid max-w-4xl gap-4 sm:grid-cols-2">
                    {(
                      [
                        'legalName',
                        'kind',
                        'country',
                        'taxId',
                        'address',
                        'website',
                        'notes',
                      ] as const
                    ).map((k) => (
                      <div key={k}>
                        <dt className="text-sm text-muted-foreground">{t(k)}</dt>
                        <dd className="whitespace-pre-wrap break-words">
                          {k === 'kind' ? t(s.kind) : s[k] || '—'}
                        </dd>
                      </div>
                    ))}
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
                </div>
              ),
            },
            {
              id: 'parts',
              label: 'Товари постачальника',
              content: (
                <div className="ops-panel space-y-5">
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
                </div>
              ),
            },
            {
              id: 'history',
              label: 'Історія',
              content: (
                <div className="ops-panel space-y-5">
                  <section>
                    <h2 className="font-semibold">{t('source')}</h2>
                    {s.sourceLinks.map((l) => (
                      <p key={l.id}>
                        {l.source} / {l.externalSupplierId} · {t('snapshot')}:{' '}
                        {l.snapshotAt.toISOString()} · {t('lastActivity')}:{' '}
                        {l.lastActivityAt?.toISOString() ?? '—'}
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
                  {cap.data?.archive && <ArchiveSupplier id={id} archived={s.isArchived} />}
                </div>
              ),
            },
          ]}
        />
      </main>
    </>
  )
}
