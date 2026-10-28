'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { listLedgerDemands } from '../Actions/ledgerActions'
import { FulfillmentPanel } from './FulfillmentPanel'
type Demand = NonNullable<Awaited<ReturnType<typeof listLedgerDemands>>['data']>[number]
type Part = {
  id?: string
  inventoryPartId?: string | null
  quantity: number
  stockOwnership?: 'OWN' | 'CUSTOMER'
  customerPartInstalled?: boolean
}
export function useWorkOrderStock(recordId?: string, recordVersion?: string) {
  const [rows, setRows] = useState<Demand[]>([]),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0),
    [selected, setSelected] = useState<string>()
  useEffect(() => {
    if (!recordId) return
    let active = true
    listLedgerDemands('', { serviceRecordId: recordId }).then((r) => {
      if (active) {
        setRows(r.data ?? [])
        setError(r.error ?? '')
      }
    })
    return () => {
      active = false
    }
  }, [recordId, revision, recordVersion])
  function indicator(part: Part) {
    if (!recordId) return null
    if (part.stockOwnership === 'CUSTOMER')
      return (
        <p className="mt-2 text-xs">
          Деталь клієнта · {part.customerPartInstalled ? 'встановлено' : 'очікує встановлення'}
        </p>
      )
    const row = rows.find((r) => r.servicePartId === part.id)
    if (row?.trackingMode === 'NON_STOCK')
      return <p className="mt-2 text-xs">Без складського обліку</p>
    const saved =
      !!row &&
      row.inventoryPartId === part.inventoryPartId &&
      Number(row.quantity) === part.quantity
    const label = !part.inventoryPartId
      ? 'Виберіть товар каталогу'
      : !part.id || !saved
        ? 'Збережіть наряд для складських дій'
        : `Резерв: ${row.reserved} · Видано: ${row.issued}`
    return (
      <div>
        <Button
          type="button"
          variant="outline"
          className="mt-2 min-h-11 h-auto max-w-full whitespace-normal text-left text-xs"
          disabled={!saved || !!error}
          onClick={() => setSelected(part.id)}
        >
          {error ? 'Немає доступу до складських даних' : label}
        </Button>
      </div>
    )
  }
  const dialog = recordId ? (
    <Dialog
      open={!!selected}
      onOpenChange={(v) => {
        if (!v) {
          setSelected(undefined)
          setRevision((n) => n + 1)
        }
      }}
    >
      <DialogContent
        onInput={(e) => e.stopPropagation()}
        className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl [&_button]:min-h-11 [&_input]:min-h-11"
      >
        <DialogHeader>
          <DialogTitle>Забезпечення позиції наряду</DialogTitle>
        </DialogHeader>
        <p>Операції застосовуються до збереженої позиції. Ціна продажу клієнту не змінюється.</p>
        <FulfillmentPanel serviceRecordId={recordId} servicePartId={selected} />
      </DialogContent>
    </Dialog>
  ) : null
  return { indicator, dialog, refresh: () => setRevision((v) => v + 1) }
}
