import { useOperationText } from '@/i18n/use-operation-text'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { moneyLabel } from '@/features/finance/presentation'

export function DocumentHeader({
  title,
  description,
  back,
  status,
  actions,
}: {
  title: string
  description?: ReactNode
  back?: { href: string; label: string }
  status?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="space-y-4">
      {back && (
        <Link
          href={back.href}
          className="inline-flex min-h-10 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
            {status}
          </div>
          {description && (
            <div className="text-sm leading-relaxed text-muted-foreground">{description}</div>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}
export function DocumentStatus({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'success' | 'danger'
}) {
  return (
    <span
      className={
        'inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ' +
        (tone === 'success'
          ? 'border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
          : tone === 'danger'
            ? 'border-destructive/30 bg-destructive/10 text-destructive'
            : 'border-border bg-muted text-muted-foreground')
      }
    >
      {children}
    </span>
  )
}
export function MoneySummary({
  items,
}: {
  items: { label: string; value: string; hint?: string; emphasis?: boolean }[]
}) {
  const ot = useOperationText()

  return (
    <dl
      className={
        'grid gap-3 ' +
        (items.length === 1
          ? 'max-w-md'
          : items.length === 2
            ? 'sm:grid-cols-2'
            : items.length === 3
              ? 'sm:grid-cols-3'
              : 'sm:grid-cols-2 xl:grid-cols-4')
      }
      aria-label={ot('Підсумки документа')}
    >
      {items.map((item) => (
        <div
          key={item.label}
          className={
            'min-w-0 rounded-xl border p-4 ' +
            (item.emphasis ? 'border-primary/40 bg-primary/5' : 'bg-card')
          }
        >
          <dt className="text-sm text-muted-foreground">{item.label}</dt>
          <dd className="mt-2 break-words text-xl font-semibold tabular-nums">
            {moneyLabel(item.value, ot('грн'))}
          </dd>
          {item.hint && <p className="mt-1 text-xs text-muted-foreground">{item.hint}</p>}
        </div>
      ))}
    </dl>
  )
}
