import Link from 'next/link'
import { ArrowRight, Link2 } from 'lucide-react'
import { documentDetail } from './actions'
import {
  documentUrl,
  documentStatus,
  type DocumentType,
  type JournalRow,
  type DocumentEdge,
} from './types'
import { dayLabel, moneyLabel } from '@/features/finance/presentation'
import { DocumentStatus } from '@/components/operations/document-ui'

export function DocumentConnections({
  root,
  documents,
  edges,
  truncated = false,
}: {
  root: string
  documents: JournalRow[]
  edges: DocumentEdge[]
  truncated?: boolean
}) {
  const byKey = new Map(documents.map((d) => [d.key, d]))
  const grouped = new Map<string, { source: string; target: string; relations: string[] }>()
  for (const edge of edges) {
    const key = edge.source + '→' + edge.target
    const group = grouped.get(key) ?? { source: edge.source, target: edge.target, relations: [] }
    if (!group.relations.includes(edge.relation)) group.relations.push(edge.relation)
    grouped.set(key, group)
  }
  return (
    <div className="space-y-3">
      {!edges.length && (
        <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
          Пов’язаних документів, доступних для вашої ролі, ще немає.
        </p>
      )}
      {[...grouped.values()].map((edge) => {
        const from = byKey.get(edge.source),
          to = byKey.get(edge.target)
        if (!from || !to) return null
        const card = (d: JournalRow) => (
          <div
            className={
              'min-w-0 rounded-lg border p-3 ' +
              (d.key === root ? 'border-primary/40 bg-primary/5' : 'bg-card')
            }
          >
            <Link
              href={documentUrl(d)}
              className="block break-words font-medium underline-offset-4 hover:underline"
            >
              {d.label}
            </Link>
            <p className="mt-1 text-xs text-muted-foreground">
              {dayLabel(d.date)} · {d.party}
            </p>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold tabular-nums">{moneyLabel(d.amount)}</span>
              <DocumentStatus>{documentStatus[d.status] ?? d.status}</DocumentStatus>
            </div>
          </div>
        )
        return (
          <div
            key={edge.source + edge.target}
            className="grid gap-2 md:grid-cols-[minmax(0,1fr)_180px_minmax(0,1fr)] md:items-center"
          >
            {card(from)}
            <p className="flex items-center justify-center gap-2 px-2 text-center text-xs text-muted-foreground">
              <ArrowRight className="size-4 shrink-0 rotate-90 md:rotate-0" aria-hidden="true" />
              <span className="space-y-1">
                {edge.relations.map((relation) => (
                  <span className="block" key={relation}>
                    {relation.replace(/(\d+\.\d{2}) грн/g, (_, amount) => moneyLabel(amount))}
                  </span>
                ))}
              </span>
            </p>
            {card(to)}
          </div>
        )
      })}
      {truncated && (
        <p role="status" className="text-sm text-muted-foreground">
          Показано перші 100 зв’язків. Відкрийте потрібний документ, щоб переглянути його зв’язки.
        </p>
      )}
    </div>
  )
}
export async function RelatedDocuments({ type, id }: { type: DocumentType; id: string }) {
  const r = await documentDetail(type, id)
  if (!r.success || !r.data) return null
  return (
    <section className="ops-workspace ops-panel space-y-4" aria-label="Пов’язані документи">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Link2 className="size-4" />
          Пов’язані документи
        </h2>
        <Link className="text-sm underline" href={documentUrl(r.data.document)}>
          Відкрити ланцюжок
        </Link>
      </div>
      <DocumentConnections
        root={r.data.document.key}
        documents={r.data.related}
        edges={r.data.edges}
        truncated={r.data.truncated}
      />
    </section>
  )
}
