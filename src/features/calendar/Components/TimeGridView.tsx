'use client'

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useTranslations } from 'next-intl'
import { useDayFormatter } from './useDayFormatter'
import { useDateSettings } from '@/components/date-settings-context'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatClock } from '@/features/workboard/utils/clock'
import { cn } from '@/lib/utils'
import {
  eventSpan,
  isWeekend,
  layoutTimedEvents,
  minutesToTime,
  toLocalDateStr,
} from '../Lib/calendar-range'
import { DayContextMenu, type DayActions } from './DayContextMenu'
import { EventChip } from './EventChip'
import { eventKey } from './calendar-utils'
import type { CalendarEvent } from '../Actions/calendarActions'

/** Pixels per hour on the grid; 24 of them make the scrollable day. */
export const HOUR_PX = 60
const GUTTER = '3.5rem'
/** All-day chips a column shows before folding the rest into a popover. */
const MAX_ALL_DAY = 3
/** The hour the grid scrolls to when the day has nothing earlier. */
const DEFAULT_SCROLL_HOUR = 7
/** A click on the grid rounds to the nearest of these. */
const SNAP_MINUTES = 30
const HOURS = Array.from({ length: 24 }, (_, h) => h)

interface TimeGridViewProps {
  days: Date[]
  eventsByDate: Map<string, CalendarEvent[]>
  todayStr: string
  selectedDateStr: string
  showWeekends: boolean
  actions: DayActions
  onSelectDate: (date: Date) => void
  onOpenDay: (date: Date) => void
}

/**
 * Day, four-day and week views share this: an all-day strip on top and a
 * 24-hour grid below, with timed events as solid blocks and double bookings
 * drawn side by side. A red line tracks the current time on today's column.
 */
export function TimeGridView({
  days,
  eventsByDate,
  todayStr,
  selectedDateStr,
  showWeekends,
  actions,
  onSelectDate,
  onOpenDay,
}: TimeGridViewProps) {
  const t = useTranslations('calendar')
  const format = useDayFormatter()
  const { timeFormat } = useDateSettings()
  const scrollRef = useRef<HTMLDivElement>(null)
  const visibleDays = useMemo(
    () => (showWeekends || days.length < 7 ? days : days.filter((d) => !isWeekend(d))),
    [days, showWeekends]
  )
  const columnsTemplate = `${GUTTER} repeat(${visibleDays.length}, minmax(0, 1fr))`

  const [nowMins, setNowMins] = useState<number | null>(null)
  useEffect(() => {
    // Seconds count too: at a minute per pixel a line that only knows the
    // minute can sit a whole pixel off, and the tick lands on the minute
    // boundary so the line never lags the wall clock by most of a minute.
    const tick = () => {
      const n = new Date()
      setNowMins(n.getHours() * 60 + n.getMinutes() + n.getSeconds() / 60)
    }
    tick()
    let interval: number | undefined
    const timeout = window.setTimeout(
      () => {
        tick()
        interval = window.setInterval(tick, 60_000)
      },
      60_000 - (Date.now() % 60_000)
    )
    return () => {
      window.clearTimeout(timeout)
      if (interval !== undefined) window.clearInterval(interval)
    }
  }, [])

  // Land the reader on the working day, or an hour before the first thing
  // scheduled if that is earlier. Only on mount: a re-scroll on every
  // navigation would fight the person scrolling.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let firstHour = DEFAULT_SCROLL_HOUR
    for (const d of visibleDays) {
      for (const e of eventsByDate.get(toLocalDateStr(d)) ?? []) {
        const span = eventSpan(e)
        if (span) firstHour = Math.min(firstHour, Math.floor(span.startMins / 60) - 1)
      }
    }
    el.scrollTop = Math.max(0, firstHour) * HOUR_PX
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Day headers */}
      <div
        className="grid shrink-0 border-b border-border/70"
        style={{ gridTemplateColumns: columnsTemplate }}
      >
        <div className="border-r border-border/70" />
        {visibleDays.map((date) => {
          const dateStr = toLocalDateStr(date)
          const isToday = dateStr === todayStr
          const isSelected = dateStr === selectedDateStr
          return (
            <button
              key={dateStr}
              type="button"
              onClick={() => (visibleDays.length === 1 ? undefined : onOpenDay(date))}
              className={cn(
                'group flex flex-col items-center gap-0.5 border-r border-border/70 py-2 transition-colors last:border-r-0',
                visibleDays.length > 1 && 'hover:bg-accent/40',
                isSelected && !isToday && 'bg-primary/5'
              )}
            >
              <span
                className={cn(
                  'text-[11px] font-medium uppercase tracking-wide',
                  isToday ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                {format.dateTime(date, { weekday: 'short' })}
              </span>
              <span
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-full text-xl font-medium tabular-nums transition-colors',
                  isToday
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground group-hover:bg-accent'
                )}
              >
                {date.getDate()}
              </span>
            </button>
          )
        })}
      </div>

      {/* All-day strip */}
      <div
        className="grid shrink-0 border-b border-border/70"
        style={{ gridTemplateColumns: columnsTemplate }}
      >
        <div className="flex items-start justify-end border-r border-border/70 px-1.5 pt-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {t('allDay')}
        </div>
        {visibleDays.map((date) => {
          const dateStr = toLocalDateStr(date)
          const allDay = (eventsByDate.get(dateStr) ?? []).filter((e) => !e.time)
          const shown = allDay.slice(0, MAX_ALL_DAY)
          const hidden = allDay.length - shown.length
          return (
            <DayContextMenu
              key={dateStr}
              date={date}
              dateStr={dateStr}
              events={eventsByDate.get(dateStr) ?? []}
              actions={actions}
              onOpen={() => onSelectDate(date)}
            >
              <div
                className="flex min-h-8 flex-col gap-0.5 border-r border-border/70 p-1 last:border-r-0"
                onClick={() => onSelectDate(date)}
              >
                {shown.map((event) => (
                  <EventChip key={eventKey(event)} event={event} variant="chip" />
                ))}
                {hidden > 0 && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        onClick={(e) => e.stopPropagation()}
                        className="h-5 rounded px-1.5 text-left text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        {t('more', { count: hidden })}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-72 p-2"
                      onOpenAutoFocus={(e) => e.preventDefault()}
                    >
                      <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
                        {allDay.map((event) => (
                          <EventChip key={eventKey(event)} event={event} variant="chip" />
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            </DayContextMenu>
          )
        })}
      </div>

      {/* Hour grid */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div
          className="relative grid"
          style={{ gridTemplateColumns: columnsTemplate, height: 24 * HOUR_PX }}
        >
          <div className="relative border-r border-border/70">
            {HOURS.map((h) =>
              h === 0 ? null : (
                <span
                  key={h}
                  className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
                  style={{ top: h * HOUR_PX }}
                >
                  {formatClock(h * 60, timeFormat)}
                </span>
              )
            )}
          </div>
          {visibleDays.map((date) => (
            <DayColumn
              key={toLocalDateStr(date)}
              date={date}
              events={eventsByDate.get(toLocalDateStr(date)) ?? []}
              isToday={toLocalDateStr(date) === todayStr}
              nowMins={nowMins}
              actions={actions}
              onSelect={() => onSelectDate(date)}
              onSlotClick={(time) => {
                onSelectDate(date)
                actions.onNewWorkOrder(toLocalDateStr(date), time)
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function minutesAtPointer(e: MouseEvent<HTMLElement>): number {
  const rect = e.currentTarget.getBoundingClientRect()
  const ratio = (e.clientY - rect.top) / Math.max(rect.height, 1)
  // Snap to the half hour: close enough to aim at, and the dialog that opens
  // is where a precise time gets typed if it matters.
  return Math.max(
    0,
    Math.min(24 * 60 - SNAP_MINUTES, Math.round((ratio * 24 * 60) / SNAP_MINUTES) * SNAP_MINUTES)
  )
}

function DayColumn({
  date,
  events,
  isToday,
  nowMins,
  actions,
  onSelect,
  onSlotClick,
}: {
  date: Date
  events: CalendarEvent[]
  isToday: boolean
  nowMins: number | null
  actions: DayActions
  onSelect: () => void
  onSlotClick: (time: string, x: number, y: number) => void
}) {
  const dateStr = toLocalDateStr(date)
  const columnRef = useRef<HTMLDivElement>(null)
  const [menuTime, setMenuTime] = useState<string | null>(null)

  const positioned = useMemo(
    () =>
      layoutTimedEvents(
        events
          .map((event) => ({ item: event, span: eventSpan(event) }))
          .filter((x): x is { item: CalendarEvent; span: NonNullable<typeof x.span> } =>
            Boolean(x.span)
          )
      ),
    [events]
  )

  return (
    <DayContextMenu
      date={date}
      dateStr={dateStr}
      events={events}
      actions={actions}
      time={menuTime}
      onOpen={onSelect}
      getAnchor={() => columnRef.current}
    >
      <div
        ref={columnRef}
        data-testid={`timegrid-day-${dateStr}`}
        className={cn(
          'relative border-r border-border/70 last:border-r-0',
          isToday && 'bg-primary/[0.03]'
        )}
        onClick={(e) => {
          // A click on a block opens its peek; a click on the grid itself
          // opens quick booking.
          if (e.target === e.currentTarget) {
            onSlotClick(minutesToTime(minutesAtPointer(e)), e.clientX, e.clientY)
          } else {
            onSelect()
          }
        }}
        onContextMenu={(e) => setMenuTime(minutesToTime(minutesAtPointer(e)))}
      >
        {HOURS.map((h) => (
          <div
            key={h}
            className="pointer-events-none absolute inset-x-0 border-t border-border/60"
            style={{ top: h * HOUR_PX }}
          >
            <div
              className="absolute inset-x-0 border-t border-dashed border-border/40"
              style={{ top: HOUR_PX / 2 }}
            />
          </div>
        ))}

        {positioned.map(({ item, startMins, endMins, column, columns }) => {
          const top = (startMins / 60) * HOUR_PX
          const height = ((endMins - startMins) / 60) * HOUR_PX
          // Overlapping events step in from the left and each runs to the
          // right edge, stacked so the later one sits on top: the first
          // keeps its title readable and every one stays wide enough to
          // read, which equal columns cannot promise on a busy morning.
          const step = columns > 1 ? Math.min(100 / columns, 35) : 0
          const left = column * step
          return (
            <EventChip
              key={eventKey(item)}
              event={item}
              variant="block"
              compact={height < 34}
              style={{
                top,
                height: Math.max(height - 2, 16),
                left: `calc(${left}% + 2px)`,
                width: `calc(${100 - left}% - 4px)`,
                zIndex: 10 + column,
              }}
            />
          )
        })}

        {isToday && nowMins !== null && (
          // Centred on the minute: the wrapper is as tall as its dot, so
          // without the shift the line itself drew six minutes late.
          <div
            className="pointer-events-none absolute inset-x-0 z-30 flex -translate-y-1/2 items-center"
            style={{ top: (nowMins / 60) * HOUR_PX }}
          >
            <span className="-ml-1.5 h-3 w-3 rounded-full bg-red-500 shadow" />
            <span className="h-0.5 flex-1 bg-red-500" />
          </div>
        )}
      </div>
    </DayContextMenu>
  )
}
