'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getSupplierCard } from '../Actions/ledgerActions'
import { DocumentAttachments } from './DocumentAttachments'
import { PartyStatement } from './PartyStatement'
const tabs = {
  receipts: 'Надходження',
  services: 'Послуги',
  orders: 'Замовлення',
  payments: 'Оплати',
}
const statuses: Record<string, string> = {
  DRAFT: 'Чернетка',
  POSTED: 'Проведено',
  CANCELLED: 'Скасовано',
  CONFIRMED: 'Підтверджено',
  PARTIALLY_RECEIVED: 'Частково отримано',
  RECEIVED: 'Отримано',
  REVERSED: 'Сторновано',
}
export function SupplierCard({
  supplierId,
  canUpload = false,
}: {
  supplierId: string
  canUpload?: boolean
}) {
  const [open, setOpen] = useState(false),
    [tab, setTab] = useState<keyof typeof tabs>('receipts'),
    [page, setPage] = useState(1),
    [data, setData] = useState<Awaited<ReturnType<typeof getSupplierCard>>['data']>(),
    [error, setError] = useState('')
  useEffect(() => {
    let live = true
    if (open) {
      setData(undefined)
      setError('')
      getSupplierCard({ supplierId, tab, page })
        .then((r) => {
          if (live) {
            setData(r.data)
            setError(r.error ?? '')
          }
        })
        .catch(() => {
          if (live) setError('Не вдалося завантажити картку')
        })
    }
    return () => {
      live = false
    }
  }, [open, supplierId, tab, page])
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Картка постачальника
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{data?.supplier.name ?? 'Постачальник'}</DialogTitle>
          </DialogHeader>
          {error && <p role="alert">{error}</p>}
          {!data && !error && <p role="status">Завантаження…</p>}
          {data && (
            <>
              <p className="break-words">
                {[
                  data.supplier.phone,
                  data.supplier.email,
                  data.supplier.taxId,
                  data.supplier.address,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <p>Відстрочка: {data.supplier.paymentTermsDays} днів</p>
              <p>
                Борг: {data.balance.debt} грн · Прострочено: {data.balance.overdue} грн · Аванс:{' '}
                {data.balance.advance} грн
              </p>
              {data.partyId && (
                <PartyStatement
                  partyId={data.partyId}
                  name={data.supplier.name}
                  through={new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(
                    new Date()
                  )}
                />
              )}
            </>
          )}
          <div className="flex flex-wrap gap-2">
            {(Object.keys(tabs) as (keyof typeof tabs)[]).map((t) => (
              <Button
                key={t}
                variant={tab === t ? 'default' : 'outline'}
                aria-pressed={tab === t}
                onClick={() => {
                  setTab(t)
                  setPage(1)
                }}
              >
                {tabs[t]}
              </Button>
            ))}
          </div>
          {data?.rows.map((r) => (
            <article key={r.id} className="grid min-w-0 gap-2 rounded border p-3">
              <strong className="break-words">{r.number}</strong>
              <p>
                {r.date} · {statuses[r.status] ?? r.status}
                {r.amount !== null && ` · ${r.amount} грн`}
              </p>
              {r.note && <p className="break-words">{r.note}</p>}
              {r.kind && <DocumentAttachments kind={r.kind} id={r.id} canUpload={canUpload} />}
            </article>
          ))}
          {data?.total === 0 && <p>Документів немає.</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              Попередня
            </Button>
            <span>
              {page} · Всього {data?.total ?? 0}
            </span>
            <Button
              disabled={!data || page * 25 >= data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Наступна
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
