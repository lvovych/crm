'use client'

import { useTranslations } from 'next-intl'
import { Check, ChevronDown } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import {
  SYSTEM_STATUSES,
  type WorkOrderStatusOption,
} from '@/features/work-order-statuses/Lib/stages'
import { statusMessageKeys } from '../../service-detail/types'

/** One explicit control, with full status names on desktop and touch screens. */
export function StatusStepper({
  status,
  customStatus = null,
  options = [],
  onChange,
  saving = false,
  message = '',
}: {
  status: string
  customStatus?: { id: string; name: string; color: string } | null
  options?: WorkOrderStatusOption[]
  onChange: (status: string, custom: WorkOrderStatusOption | null) => void
  saving?: boolean
  message?: string
}) {
  const t = useTranslations('service')
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const label = (value: string) =>
    statusMessageKeys[value] ? t(`basicInfo.statusOptions.${statusMessageKeys[value]}`) : value
  const current = customStatus?.name || label(status)
  const choices = SYSTEM_STATUSES.flatMap((stage) => [
    { id: stage, name: label(stage), stage, custom: null as WorkOrderStatusOption | null },
    ...options
      .filter((option) => option.stage === stage)
      .map((option) => ({ id: option.id, name: option.name, stage, custom: option })),
  ])
  return (
    <section
      data-testid="status-control"
      className="rounded-lg border border-card-edge bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold" id="work-order-status-label">
            {t('assignment.status')}
          </h2>
          <p role="status" className="mt-1 text-sm text-muted-foreground">
            {saving ? t('assignment.saving') : message || t('assignment.statusHint')}
          </p>
        </div>
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          disabled={saving}
          onClick={() => setOpen(true)}
          aria-labelledby="work-order-status-label work-order-status-value"
          aria-haspopup="dialog"
          className="min-h-11 w-full justify-between gap-3 whitespace-normal text-left sm:w-auto sm:min-w-60"
        >
          <span id="work-order-status-value" data-testid="current-status">
            {current}
          </span>
          <ChevronDown className="size-4 shrink-0" />
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            triggerRef.current?.focus()
          }}
          className="max-h-[85dvh] overflow-y-auto sm:max-w-md [&>[data-slot=dialog-close]]:min-h-11 [&>[data-slot=dialog-close]]:min-w-11"
        >
          <DialogTitle className="pr-12 text-left">{t('assignment.status')}</DialogTitle>
          <DialogDescription>{t('assignment.statusHint')}</DialogDescription>
          <div className="space-y-2" role="group" aria-label={t('assignment.status')}>
            {choices.map((choice) => {
              const selected = customStatus ? customStatus.id === choice.id : status === choice.id
              return (
                <Button
                  key={choice.id}
                  type="button"
                  variant="outline"
                  disabled={saving}
                  aria-pressed={selected}
                  className="h-auto min-h-12 w-full justify-between whitespace-normal px-3 py-3 text-left"
                  onClick={() => {
                    setOpen(false)
                    if (!selected) onChange(choice.stage, choice.custom)
                  }}
                >
                  <span>
                    {choice.name}
                    {choice.custom && (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {label(choice.stage)}
                      </span>
                    )}
                  </span>
                  {selected && <Check className="ml-2 size-4 shrink-0" aria-hidden="true" />}
                </Button>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
