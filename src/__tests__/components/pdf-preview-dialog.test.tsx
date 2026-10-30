import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PdfPreviewDialog } from '@/components/pdf-preview-dialog'

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: any) => (open ? children : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h1>{children}</h1>,
}))
const share = vi.fn()
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob(['%PDF-1.7 test bytes'], { type: 'application/pdf' }),
      headers: new Headers({ 'Content-Disposition': `attachment; filename="invoice-123.pdf"` }),
    }))
  )
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:preview-only'),
      revokeObjectURL: vi.fn(),
    })
  )
  Object.defineProperty(navigator, 'share', { configurable: true, value: share })
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: vi.fn(() => true) })
  share.mockReset().mockResolvedValue(undefined)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('downloads from HTTP and shares a named PDF File, never a blob link', async () => {
  render(<PdfPreviewDialog open onOpenChange={vi.fn()} url="/api/protected/services/123/pdf" />)
  const download = await screen.findByRole('link', { name: 'download' })
  expect(download).toHaveAttribute('href', '/api/protected/services/123/pdf?download=1')
  expect(download).toHaveAttribute('download', 'invoice-123.pdf')
  fireEvent.click(screen.getByRole('button', { name: 'share' }))
  expect(share).toHaveBeenCalledTimes(1)
  const data = share.mock.calls[0][0]
  expect(Object.keys(data)).toEqual(['files'])
  expect(data.files[0]).toBeInstanceOf(File)
  expect(data.files[0].name).toBe('invoice-123.pdf')
  expect(data.files[0].type).toBe('application/pdf')
  expect(data.files[0].size).toBe(19)
  await waitFor(() => expect(screen.getByRole('button', { name: 'share' })).toBeEnabled())
})
it('keeps download available when file sharing is unsupported', async () => {
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false })
  render(<PdfPreviewDialog open onOpenChange={vi.fn()} url="/act" />)
  await screen.findByRole('link', { name: 'download' })
  expect(screen.queryByRole('button', { name: 'share' })).toBeNull()
})
it('ignores user cancellation but reports a failed share without sharing a URL', async () => {
  share.mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'))
  render(<PdfPreviewDialog open onOpenChange={vi.fn()} url="/act" />)
  fireEvent.click(await screen.findByRole('button', { name: 'share' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'share' })).toBeEnabled())
  expect(screen.queryByRole('alert')).toBeNull()
  share.mockRejectedValueOnce(new Error('failed'))
  fireEvent.click(screen.getByRole('button', { name: 'share' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('shareFailed')
  expect(screen.getByRole('link', { name: 'download' })).toBeVisible()
})
it('does not share the previous document while another PDF loads', async () => {
  const { rerender } = render(<PdfPreviewDialog open onOpenChange={vi.fn()} url="/invoice" />)
  await screen.findByRole('button', { name: 'share' })
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise(() => {
        /* Keep the next document loading. */
      })
  )
  rerender(<PdfPreviewDialog open onOpenChange={vi.fn()} url="/act" />)
  expect(screen.queryByRole('button', { name: 'share' })).toBeNull()
})
