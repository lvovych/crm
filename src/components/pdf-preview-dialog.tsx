'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { downloadFilename } from '@/lib/document-filename'
import { Button } from '@/components/ui/button'
import { Loader2, Download, Share2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface PdfPreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Endpoint that answers the finished PDF, e.g. /api/protected/services/[id]/pdf */
  url: string
}

/**
 * Shows the document's real PDF in a dialog, next to the download button.
 *
 * The file is fetched fresh on every open rather than cached, so the preview
 * always matches what download, email, and share would produce right now —
 * which is the whole point of looking before sending.
 */
export function PdfPreviewDialog({ open, onOpenChange, url }: PdfPreviewDialogProps) {
  const t = useTranslations('common.pdfPreview')
  const tc = useTranslations('service.attachments')
  const [pdf, setPdf] = useState<{ file: File; url: string } | null>(null)
  const [sharing, setSharing] = useState(false)
  const [shareFailed, setShareFailed] = useState(false)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    let created: string | null = null
    setBlobUrl(null)
    setPdf(null)
    setShareFailed(false)
    setFailed(false)

    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed')
        const blob = await res.blob()
        if (cancelled) return
        created = URL.createObjectURL(blob)
        setPdf({
          file: new File([blob], downloadFilename(res.headers.get('Content-Disposition')), {
            type: 'application/pdf',
          }),
          url,
        })
        setBlobUrl(created)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [open, url])

  const file = open && pdf?.url === url ? pdf.file : null
  const canShare =
    !!file &&
    typeof navigator.canShare === 'function' &&
    typeof navigator.share === 'function' &&
    navigator.canShare({ files: [file] })
  const downloadUrl = `${url}${url.includes('?') ? '&' : '?'}download=1`

  const sharePdf = async () => {
    if (!file || sharing) return
    setSharing(true)
    setShareFailed(false)
    try {
      // The File is ready before the tap: awaiting fetch here loses iOS user activation.
      // Never pass a blob URL (or the private endpoint) to the receiving app.
      await navigator.share({ files: [file] })
    } catch (error) {
      if (!(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')) {
        setShareFailed(true)
      }
    } finally {
      setSharing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The document is the content; there is nothing to say about it that the title does not. */}
      <DialogContent className="flex h-[90vh] flex-col sm:max-w-5xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>
        {file && (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <a href={downloadUrl} download={file.name}>
                <Download className="mr-2 size-4" />
                {tc('download')}
              </a>
            </Button>
            {canShare && (
              <Button variant="outline" onClick={sharePdf} disabled={sharing}>
                <Share2 className="mr-2 size-4" />
                {t('share')}
              </Button>
            )}
          </div>
        )}
        {shareFailed && (
          <p role="alert" className="text-sm text-destructive">
            {t('shareFailed')}
          </p>
        )}
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-muted">
          {failed ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
              {t('failed')}
            </div>
          ) : blobUrl ? (
            <iframe src={blobUrl} title={t('title')} className="h-full w-full" />
          ) : (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
