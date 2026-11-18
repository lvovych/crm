'use client'
import { useOperationText } from '@/i18n/use-operation-text'
import { useState } from 'react'
import { documentHistory } from '@/features/customer-ledger/history'
import { moneyLabel, dayLabel } from '@/features/finance/presentation'
import type { DocumentRow } from './types'
export function LedgerHistory({ row }: { row: DocumentRow }) {
  const ot = useOperationText()

  const [events, setEvents] = useState(row.history ?? [])
  const [loaded, setLoaded] = useState(!!row.history)
  const [next, setNext] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function load() {
    if (busy || !row.historyAsOf) return
    setBusy(true)
    setError('')
    try {
      const r = await documentHistory(row.id, row.historyAsOf, next ?? undefined)
      if (!r.success || !r.data) throw new Error(r.error || ot('Не вдалося завантажити історію.'))
      setEvents((previous) => [...previous, ...r.data!.events])
      setNext(r.data.next)
      setLoaded(true)
    } catch {
      setError(ot('Не вдалося завантажити історію. Повторіть спробу.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <details
      className="mt-4 rounded-lg border p-3"
      onToggle={(e) => {
        if (e.currentTarget.open && !loaded && !busy) void load()
      }}
    >
      <summary className="min-h-11 cursor-pointer font-medium">
        {ot('Історія зобов’язань і оплат')}
        {` (${row.historyCount ?? events.length})`}
      </summary>
      <ol className="mt-3 space-y-3" aria-label={ot('Історія документа')}>
        {events.map((event) => (
          <li key={event.id} className="border-t pt-3 text-sm">
            <p className="font-medium">
              {(
                {
                  created: ot('Створено наряд'),
                  completed: ot('Виникло зобов’язання'),
                  adjusted: ot('Змінено суму або умови'),
                  status_changed: ot('Змінено статус'),
                  cancelled: ot('Скасовано зобов’язання'),
                  payment: ot('Отримано оплату'),
                  payment_reversed: ot('Сторновано запис оплати'),
                  refund: ot('Повернення клієнту'),
                  deleted: ot('Видалено порожній наряд'),
                } as Record<string, string>
              )[event.kind] ?? event.kind}{' '}
              · {dayLabel(event.date)}
            </p>
            <p>
              {ot("Зміна зобов’язання: ")}
              {moneyLabel(event.chargeDelta, ot('грн'))} {ot(" · Зміна оплат:")} {moneyLabel(event.paidDelta, ot('грн'))}
            </p>
            <p className="text-muted-foreground">
              {event.actor ?? ot('Система / автор не зафіксований')} {ot(" · Зареєстровано")}{' '}
              {event.recordedAt.replace('T', ' ').replace('Z', ' UTC')}
            </p>
            {event.sourceDate && event.sourceDate !== event.date && (
              <p>
                {ot("Дата первинної оплати: ")}
                {dayLabel(event.sourceDate)}
              </p>
            )}
            {event.manualPaid && (
              <p>{ot('Ручна позначка «Оплачено» не замінює фактичну оплату й не зменшує борг.')}</p>
            )}
            {event.note && <p className="break-words">{event.note}</p>}
          </li>
        ))}
      </ol>
      {busy && <p role="status">{ot('Завантаження…')}</p>}
      {error && <p role="alert">{error}</p>}
      {(next || error) && (
        <button
          type="button"
          disabled={busy}
          className="min-h-11 underline"
          onClick={() => void load()}
        >
          {error ? ot('Повторити') : ot('Попередні записи')}
        </button>
      )}
    </details>
  )
}
