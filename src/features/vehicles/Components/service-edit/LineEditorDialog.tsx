'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/confirm-dialog'

export function LineEditorDialog({
  title,
  dirty,
  children,
  onCancel,
  onSave,
  onDelete,
  error,
}: {
  title: string
  dirty: boolean
  children: ReactNode
  onCancel: () => void
  onSave: () => void
  onDelete?: () => void
  error?: string
}) {
  const t = useTranslations('service.lineEditor')
  const confirm = useConfirm()
  const [viewport, setViewport] = useState<{ height: number; top: number } | null>(null)
  useEffect(() => {
    const view = window.visualViewport
    const resize = () =>
      setViewport(
        window.innerWidth < 640 && view ? { height: view.height, top: view.offsetTop } : null
      )
    resize()
    view?.addEventListener('resize', resize)
    view?.addEventListener('scroll', resize)
    return () => {
      view?.removeEventListener('resize', resize)
      view?.removeEventListener('scroll', resize)
    }
  }, [])
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  async function close() {
    if (
      !dirty ||
      (await confirm({
        title: t('discardTitle'),
        description: t('discardBody'),
        confirmLabel: t('discard'),
        cancelLabel: t('continue'),
      }))
    )
      onCancel()
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void close()
      }}
    >
      <DialogContent
        data-line-editor
        showCloseButton={false}
        className="flex max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 h-[100dvh] max-h-[100dvh] sm:h-auto sm:max-h-[85dvh] sm:max-w-2xl sm:rounded-xl"
        style={
          viewport
            ? {
                height: viewport.height,
                top: viewport.top,
                left: 0,
                translate: 'none',
                transform: 'none',
              }
            : undefined
        }
        onInput={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') e.preventDefault()
        }}
      >
        <header className="shrink-0 border-b p-4">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="mt-2">{t('saveHint')}</DialogDescription>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 [&_input]:min-h-11 [&_button[role=combobox]]:min-h-11 [&_input]:text-base [&_textarea]:text-base [&_select]:text-base">
          {children}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <footer className="flex shrink-0 flex-wrap gap-2 border-t bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {onDelete && (
            <Button
              type="button"
              variant="destructive"
              className="min-h-11"
              onClick={async () => {
                if (
                  await confirm({
                    title: t('deleteTitle'),
                    description: t('deleteBody'),
                    confirmLabel: t('delete'),
                    cancelLabel: t('cancel'),
                    destructive: true,
                  })
                )
                  onDelete()
              }}
            >
              {t('delete')}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            className="ml-auto min-h-11"
            onClick={() => void close()}
          >
            {t('cancel')}
          </Button>
          <Button type="button" className="min-h-11" onClick={onSave}>
            {t('save')}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  )
}

export function LineField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
      <span>{label}</span>
      {children}
    </label>
  )
}
