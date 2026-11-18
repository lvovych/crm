import { getOperationText } from '@/i18n/operation-text.server'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { DocumentHeader, DocumentStatus, MoneySummary } from '@/components/operations/document-ui'
import { documentDetail } from '@/features/documents/actions'
import { DocumentConnections } from '@/features/documents/RelatedDocuments'
import { documentStatus, documentTypes } from '@/features/documents/types'
import { dayLabel } from '@/features/finance/presentation'
export default async function DocumentPage({
  params,
}: {
  params: Promise<{ type: string; id: string }>
}) {
  const ot = await getOperationText()

  const { type, id } = await params,
    r = await documentDetail(type, id)
  if (!r.success)
    return (
      <p role="alert" className="p-6">
        {r.error}
      </p>
    )
  if (!r.data) notFound()
  const { document: d, related, edges, truncated } = r.data
  return (
    <>
      <PageHeader />
      <main className="ops-workspace mx-auto w-full max-w-7xl space-y-6 p-4 pb-24 sm:p-6 md:pb-6">
        <DocumentHeader
          title={d.label}
          back={{ href: '/documents', label: ot('Журнал документів') }}
          description={ot(documentTypes[d.type]) + ' · ' + dayLabel(d.date)}
          status={
            <DocumentStatus
              tone={
                ['posted', 'completed'].includes(d.status)
                  ? 'success'
                  : ['reversed', 'cancelled'].includes(d.status)
                    ? 'danger'
                    : 'neutral'
              }
            >
              {ot(documentStatus[d.status]) ?? d.status}
            </DocumentStatus>
          }
          actions={
            <Button asChild variant="outline">
              <Link href={d.href}>
                {d.type === 'finance'
                  ? ot('Відкрити каси та рахунки')
                  : ot('Відкрити первинний документ')}
              </Link>
            </Button>
          }
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneySummary
            items={[{ label: ot('Сума документа'), value: d.amount, emphasis: true }]}
          />
          <dl className="ops-panel space-y-3">
            <div>
              <dt className="text-sm text-muted-foreground">{ot('Контрагент / працівник')}</dt>
              <dd className="mt-1 font-medium">{d.party || '—'}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">{ot('Підстава та реквізити')}</dt>
              <dd className="mt-1 whitespace-pre-wrap break-words text-sm">{d.note || '—'}</dd>
            </div>
          </dl>
        </div>
        <section className="ops-panel space-y-4">
          <h2 className="text-lg font-semibold">{ot('Ланцюжок документів')}</h2>
          <p className="text-sm text-muted-foreground">
            {ot('Натисніть документ, щоб переглянути його зв’язки та відкрити оригінал.')}
          </p>
          <DocumentConnections
            root={d.key}
            documents={related}
            edges={edges}
            truncated={truncated}
          />
        </section>
      </main>
    </>
  )
}
