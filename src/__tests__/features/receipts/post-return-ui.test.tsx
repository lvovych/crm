import { beforeEach as beforeLocale, vi as localeMock } from 'vitest'
import { useLocale as testLocale } from 'next-intl'
// These scenarios exercise the Ukrainian operational interface.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { expect, it, vi, beforeEach } from 'vitest'
const f = vi.hoisted(() => ({ post: vi.fn(), refresh: vi.fn() }))
vi.mock('@/features/receipts/return-actions', () => ({ completeSupplierReturn: f.post }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: f.refresh }) }))
import { PostReturnButton } from '@/features/receipts/PostReturnButton'
beforeEach(() => vi.clearAllMocks())
it('requires an explicit click, blocks repeated clicks, and refreshes after posting', async () => {
  let finish!: (r: unknown) => void
  f.post.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r
      })
  )
  render(<PostReturnButton id="draft" version={2} />)
  expect(f.post).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Провести повернення' }))
  expect(screen.getByRole('button')).toBeDisabled()
  fireEvent.click(screen.getByRole('button'))
  expect(f.post).toHaveBeenCalledTimes(1)
  expect(f.post).toHaveBeenCalledWith('draft', 2)
  finish({ success: true, data: 'draft' })
  await waitFor(() => expect(f.refresh).toHaveBeenCalledTimes(1))
})
it('keeps the draft visible and explains a stock failure', async () => {
  f.post.mockResolvedValue({ success: false, error: 'Недостатньо залишку на складі.' })
  render(<PostReturnButton id="draft" version={1} />)
  fireEvent.click(screen.getByRole('button'))
  expect(await screen.findByRole('alert')).toHaveTextContent('Недостатньо залишку')
  expect(f.refresh).not.toHaveBeenCalled()
  expect(screen.getByRole('button')).toBeEnabled()
})

beforeLocale(() => localeMock.mocked(testLocale).mockReturnValue('uk'))
