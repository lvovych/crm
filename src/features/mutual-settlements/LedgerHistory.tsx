'use client'
import { useState } from 'react'
import { documentHistory } from '@/features/customer-ledger/history'
import { moneyLabel, dayLabel } from '@/features/finance/presentation'
import type { DocumentRow } from './types'
export function LedgerHistory({ row }: { row: DocumentRow }) {
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
      if (!r.success || !r.data) throw new Error(r.error || 'Не вдалося завантажити історію.')
      setEvents((previous) => [...previous, ...r.data!.events])
      setNext(r.data.next)
      setLoaded(true)
    } catch {
      setError('Не вдалося завантажити історію. Повторіть спробу.')
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
        Історія зобов’язань і оплат{` (${row.historyCount ?? events.length})`}
      </summary>
      <ol className="mt-3 space-y-3" aria-label="Історія документа">
        {events.map((event) => (
          <li key={event.id} className="border-t pt-3 text-sm">
            <p className="font-medium">
              {(
                {
                  created: 'Створено наряд',
                  completed: 'Виникло зобов’язання',
                  adjusted: 'Змінено суму або умови',
                  status_changed: 'Змінено статус',
                  cancelled: 'Скасовано зобов’язання',
                  payment: 'Отримано оплату',
                  payment_reversed: 'Сторновано запис оплати',
                  refund: 'Повернення клієнту',
                  deleted: 'Видалено порожній наряд',
                } as Record<string, string>
              )[event.kind] ?? event.kind}{' '}
              · {dayLabel(event.date)}
            </p>
            <p>
              Зміна зобов’язання: {moneyLabel(event.chargeDelta)} · Зміна оплат:{' '}
              {moneyLabel(event.paidDelta)}
            </p>
            <p className="text-muted-foreground">
              {event.actor ?? 'Система / автор не зафіксований'} · Зареєстровано{' '}
              {event.recordedAt.replace('T', ' ').replace('Z', ' UTC')}
            </p>
            {event.sourceDate && event.sourceDate !== event.date && (
              <p>Дата первинної оплати: {dayLabel(event.sourceDate)}</p>
            )}
            {event.manualPaid && (
              <p>Ручна позначка «Оплачено» не замінює фактичну оплату й не зменшує борг.</p>
            )}
            {event.note && <p className="break-words">{event.note}</p>}
          </li>
        ))}
      </ol>
      {busy && <p role="status">Завантаження…</p>}
      {error && <p role="alert">{error}</p>}
      {(next || error) && (
        <button
          type="button"
          disabled={busy}
          className="min-h-11 underline"
          onClick={() => void load()}
        >
          {error ? 'Повторити' : 'Попередні записи'}
        </button>
      )}
    </details>
  )
}
