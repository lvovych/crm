// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/get-auth-context', () => ({ getAuthContext: vi.fn() }))
vi.mock('@/lib/with-auth', () => ({ withAuth: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: { serviceRecord: { findFirst: vi.fn() } } }))
vi.mock('@/features/invoices/Pdf/buildCompletionActPdfBuffer', () => ({
  buildCompletionActPdfBuffer: vi.fn(),
}))
import { GET } from '@/app/api/protected/services/[id]/completion-act-pdf/route'
import { getAuthContext } from '@/lib/get-auth-context'
import { withAuth } from '@/lib/with-auth'
import { db } from '@/lib/db'
import { buildCompletionActPdfBuffer } from '@/features/invoices/Pdf/buildCompletionActPdfBuffer'
const ctx = {
  organizationId: 'org-a',
  userId: 'u',
  role: 'owner',
  isAdmin: true,
  isSuperAdmin: false,
}
const request = () =>
  GET(new Request('https://example.com'), { params: Promise.resolve({ id: 'order-b' }) })
beforeEach(() => vi.resetAllMocks())
describe('private completion act route', () => {
  it('requires authentication', async () => {
    vi.mocked(getAuthContext).mockResolvedValue(null)
    expect((await request()).status).toBe(401)
    expect(buildCompletionActPdfBuffer).not.toHaveBeenCalled()
  })
  it('requires service read permission', async () => {
    vi.mocked(getAuthContext).mockResolvedValue(ctx)
    vi.mocked(withAuth).mockResolvedValue({
      success: false,
      error: 'Insufficient permissions',
      forbidden: true,
    })
    expect((await request()).status).toBe(403)
    expect(withAuth).toHaveBeenCalledWith(expect.any(Function), {
      requiredPermissions: [{ action: 'read', subject: 'services' }],
    })
    expect(buildCompletionActPdfBuffer).not.toHaveBeenCalled()
  })
  it('never renders another organization’s record', async () => {
    vi.mocked(getAuthContext).mockResolvedValue(ctx)
    vi.mocked(withAuth).mockImplementation(async (action) => ({
      success: true,
      data: await action(ctx),
    }))
    vi.mocked(db.serviceRecord.findFirst).mockResolvedValue(null)
    expect((await request()).status).toBe(404)
    expect(db.serviceRecord.findFirst).toHaveBeenCalledWith({
      where: { id: 'order-b', organizationId: 'org-a' },
      select: { id: true },
    })
    expect(buildCompletionActPdfBuffer).not.toHaveBeenCalled()
  })
  it('returns a non-cacheable PDF for an owned record', async () => {
    vi.mocked(getAuthContext).mockResolvedValue(ctx)
    vi.mocked(withAuth).mockImplementation(async (action) => ({
      success: true,
      data: await action(ctx),
    }))
    vi.mocked(db.serviceRecord.findFirst).mockResolvedValue({ id: 'order-b' } as never)
    vi.mocked(buildCompletionActPdfBuffer).mockResolvedValue({
      buffer: Buffer.from('%PDF-test'),
      filename: 'completion-act-order-b.pdf',
    })
    const response = await request()
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(await response.text()).toBe('%PDF-test')
  })
})
