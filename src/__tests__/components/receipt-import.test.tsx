import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const m = vi.hoisted(() => ({ status: vi.fn(), start: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: m.refresh }) }))
vi.mock('@/features/receipts/import-actions', () => ({
  receiptImportStatus: m.status,
  startReceiptImport: m.start,
}))
import { ImportReceipts } from '@/features/receipts/ImportReceipts'

const supplier = (connectorId: string, name: string, status = 'done') => ({
  connectorId,
  name,
  configured: true,
  job: { id: connectorId + '-job', status, error: null, attempts: 0 },
  progress: { created: 0, skipped: 25, processed: 25 },
})
beforeEach(() => {
  vi.clearAllMocks()
  m.status.mockResolvedValue({
    success: true,
    data: {
      configured: true,
      suppliers: [supplier('bm-parts', 'Бус Маркет S'), supplier('ukrcar', 'Укркар')],
    },
  })
})
it('shows both suppliers, their results and configuration links', async () => {
  render(<ImportReceipts />)
  expect(await screen.findByRole('link', { name: 'Бус Маркет S' })).toHaveAttribute(
    'href',
    '/settings/integrations/bm-parts'
  )
  expect(screen.getByRole('link', { name: 'Укркар' })).toHaveAttribute(
    'href',
    '/settings/integrations/ukrcar'
  )
  expect(screen.getAllByRole('status')).toHaveLength(2)
  expect(screen.getByRole('button')).toBeEnabled()
  expect(m.refresh).toHaveBeenCalled()
})
it('disables repeated clicks while any supplier is running', async () => {
  m.status.mockResolvedValue({
    success: true,
    data: {
      configured: true,
      suppliers: [supplier('bm-parts', 'BM', 'running'), supplier('ukrcar', 'UC')],
    },
  })
  render(<ImportReceipts />)
  await screen.findByRole('link', { name: 'BM' })
  expect(screen.getByRole('button')).toBeDisabled()
  fireEvent.click(screen.getByRole('button'))
  expect(m.start).not.toHaveBeenCalled()
})
it('links to setup and disables import when no supplier is connected', async () => {
  m.status.mockResolvedValue({ success: true, data: { configured: false, suppliers: [] } })
  render(<ImportReceipts />)
  expect(await screen.findByRole('link')).toHaveAttribute('href', '/settings/integrations')
  expect(screen.getByRole('button')).toBeDisabled()
})
it('keeps a successful supplier queued while displaying another supplier failure', async () => {
  m.start.mockImplementation(async () => {
    m.status.mockResolvedValue({
      success: true,
      data: {
        configured: true,
        suppliers: [supplier('bm-parts', 'Бус Маркет S', 'queued'), supplier('ukrcar', 'Укркар')],
      },
    })
    return {
      success: true,
      data: {
        results: [
          { connectorId: 'bm-parts', jobId: 'bm-job', error: null },
          { connectorId: 'ukrcar', jobId: null, error: 'Укркар: перевірте налаштування' },
        ],
      },
    }
  })
  render(<ImportReceipts />)
  await waitFor(() => expect(screen.getByRole('button')).toBeEnabled())
  fireEvent.click(screen.getByRole('button'))
  expect(await screen.findByRole('alert')).toHaveTextContent('Укркар: перевірте налаштування')
  await waitFor(() => expect(screen.getByRole('button')).toBeDisabled())
  expect(m.start).toHaveBeenCalledTimes(1)
})
