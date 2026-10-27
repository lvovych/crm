// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db', () => ({
  db: {
    serviceRecord: { findUnique: vi.fn() },
    quote: { findFirst: vi.fn() },
    inspection: { findFirst: vi.fn() },
    statusReport: { findFirst: vi.fn() },
    appSetting: { findMany: vi.fn() },
  },
}))
vi.mock('fs/promises', () => ({ stat: vi.fn(), readFile: vi.fn(async () => Buffer.from('file')) }))
vi.mock('@/lib/upload-root', () => ({ uploadsRoot: () => '/uploads' }))
import { db } from '@/lib/db'
import { readFile } from 'fs/promises'
import { GET } from '@/app/api/public/files/[token]/[...path]/route'

const url = '/api/protected/files/org-a/services/allowed.jpg'
const request = (category = 'services', filename = 'allowed.jpg') =>
  GET(new NextRequest('https://example.test/api/public/files/token/services/allowed.jpg'), {
    params: Promise.resolve({ token: 'token', path: [category, filename] }),
  })
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(db.serviceRecord.findUnique).mockResolvedValue(null)
  vi.mocked(db.quote.findFirst).mockResolvedValue(null)
  vi.mocked(db.inspection.findFirst).mockResolvedValue(null)
  vi.mocked(db.statusReport.findFirst).mockResolvedValue(null)
  vi.mocked(db.appSetting.findMany).mockResolvedValue([])
})
it('refuses an invalid token before reading disk', async () => {
  expect((await request()).status).toBe(404)
  expect(readFile).not.toHaveBeenCalled()
})
it('serves an invoice attachment without persistent caching', async () => {
  vi.mocked(db.serviceRecord.findUnique).mockResolvedValue({
    organizationId: 'org-a',
    attachments: [{ fileUrl: url }],
  } as never)
  const res = await request()
  expect(res.status).toBe(200)
  expect(res.headers.get('cache-control')).toBe('private, no-store')
  expect(db.serviceRecord.findUnique).toHaveBeenCalledWith(
    expect.objectContaining({
      select: expect.objectContaining({
        attachments: expect.objectContaining({ where: { includeInInvoice: true } }),
      }),
    })
  )
})
it('refuses a known file of another document in the same organization', async () => {
  vi.mocked(db.serviceRecord.findUnique).mockResolvedValue({
    organizationId: 'org-a',
    attachments: [{ fileUrl: url }],
  } as never)
  expect((await request('services', 'other-customer.pdf')).status).toBe(404)
  expect(readFile).not.toHaveBeenCalled()
})
it('refuses hidden attachments excluded by the database visibility filter', async () => {
  vi.mocked(db.quote.findFirst).mockResolvedValue({
    organizationId: 'org-a',
    attachments: [],
  } as never)
  expect((await request()).status).toBe(404)
  expect(db.quote.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      select: expect.objectContaining({
        attachments: expect.objectContaining({ where: { includeInInvoice: true } }),
      }),
    })
  )
  expect(readFile).not.toHaveBeenCalled()
})
it('serves inspection item images stored under the legacy API prefix', async () => {
  vi.mocked(db.inspection.findFirst).mockResolvedValue({
    organizationId: 'org-a',
    attachments: [],
    items: [{ imageUrls: [url.replace('/protected', '')] }],
  } as never)
  expect((await request()).status).toBe(200)
})
it('refuses an expired status report even when its file is known', async () => {
  vi.mocked(db.statusReport.findFirst).mockResolvedValue({
    organizationId: 'org-a',
    videoUrl: url,
    expiresAt: new Date(0),
  } as never)
  expect((await request()).status).toBe(404)
  expect(readFile).not.toHaveBeenCalled()
})
it('serves a live status report only its own video', async () => {
  vi.mocked(db.statusReport.findFirst).mockResolvedValue({
    organizationId: 'org-a',
    videoUrl: url,
    expiresAt: null,
  } as never)
  expect((await request()).status).toBe(200)
  expect((await request('services', 'unrelated.mp4')).status).toBe(404)
})
it('allows only a configured workshop logo', async () => {
  vi.mocked(db.serviceRecord.findUnique).mockResolvedValue({
    organizationId: 'org-a',
    attachments: [],
  } as never)
  vi.mocked(db.appSetting.findMany).mockResolvedValue([
    { value: '/api/protected/files/org-a/logos/logo.png' },
  ] as never)
  expect((await request('logos', 'logo.png')).status).toBe(200)
  expect((await request('logos', 'private.png')).status).toBe(404)
})
it('refuses traversal before querying or reading files', async () => {
  expect((await request('services', '../secret')).status).toBe(400)
  expect(db.serviceRecord.findUnique).not.toHaveBeenCalled()
  expect(readFile).not.toHaveBeenCalled()
})
