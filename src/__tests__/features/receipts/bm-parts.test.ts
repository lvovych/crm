// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { BmPartsClient } from '@/integrations/bm-parts/client'
import { parseReceipt, receiptReference } from '@/integrations/bm-parts/parser'

const period = { from: '2026-11-06', to: '2026-11-19' }
const fixture = () => ({
  document_uuid: '933B005056BAD76D11F1D9CB351F4EE7',
  number: 'ДГ003640351',
  created_at: '2026-11-06T12:17:10Z',
  currency: { name: 'ГРН' },
  total: 251,
  products: [
    {
      quantity: 2,
      price: 125.5,
      total: 251,
      product: {
        article: '458.580',
        name: 'Gasket',
        name_for_invoice: 'Прокладка',
        brand: { name: 'ELRING' },
      },
    },
  ],
})

describe('BM Parts receipt adapter', () => {
  it('preserves supplier number, invoice name, article and exact totals', () => {
    const raw = fixture()
    const result = parseReceipt(raw, receiptReference(raw, period))
    expect(result.number).toBe('ДГ003640351')
    expect(result.lines[0]).toEqual({
      brand: 'ELRING',
      article: '458.580',
      name: 'Прокладка',
      quantity: '2',
      unitPrice: '125.5',
      amount: '251.00',
    })
  })
  it.each([
    'currency',
    'quantity',
    'line',
    'total',
    'empty',
  ] as const)('rejects invalid %s without creating a partial document', (kind) => {
    const raw = fixture()
    if (kind === 'currency') raw.currency.name = 'EUR'
    if (kind === 'quantity') raw.products[0].quantity = -2
    if (kind === 'line') raw.products[0].total = 250.99
    if (kind === 'total') raw.total = 250.99
    if (kind === 'empty') raw.products = []
    expect(() => parseReceipt(raw, receiptReference(raw, period))).toThrow('некоректні')
  })
  it('rejects invalid dates, missing IDs and documents outside the fixed period', () => {
    expect(() =>
      receiptReference({ ...fixture(), created_at: '2026-02-30T00:00:00Z' }, period)
    ).toThrow()
    expect(() => receiptReference({ ...fixture(), document_uuid: '' }, period)).toThrow()
    expect(() =>
      receiptReference({ ...fixture(), created_at: '2026-11-05T23:59:59Z' }, period)
    ).toThrow('періодом')
  })
  it('sends the raw token only to the fixed API with a User-Agent and encoded period', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ documents: [] }))
    const client = new BmPartsClient({ apiKey: 'test-secret' }, fetcher)
    expect(await client.sales(period, 2)).toEqual([])
    const [address, init] = fetcher.mock.calls[0]
    const url = new URL(address)
    expect(url.origin).toBe('https://api.bm.parts')
    expect(url.searchParams.get('period')).toBe('{2026-11-06,2026-11-19}')
    expect(url.searchParams.get('page')).toBe('2')
    expect(init.headers.Authorization).toBe('test-secret')
    expect(init.headers['User-Agent']).toBe('LautoCRM/1.0')
    expect(init.redirect).toBe('error')
  })
  it.each([401, 403, 429, 500])('does not expose an HTTP %s body or key', async (status) => {
    const fetcher = vi.fn().mockResolvedValue(new Response('test-secret', { status }))
    await expect(
      new BmPartsClient({ apiKey: 'test-secret' }, fetcher).sales(period, 1)
    ).rejects.not.toThrow('test-secret')
  })
  it('fails on a missing documents field instead of reporting an empty import', async () => {
    for (const body of [{}, { documents: 'invalid' }]) {
      const fetcher = vi.fn().mockResolvedValue(Response.json(body))
      await expect(new BmPartsClient({ apiKey: 'test' }, fetcher).sales(period, 1)).rejects.toThrow(
        'формат'
      )
    }
  })
})

it('accepts the documented null documents sentinel on the last page', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ documents: null }))
  await expect(new BmPartsClient({ apiKey: 'test' }, fetcher).sales(period, 2)).resolves.toEqual([])
})

it('rejects oversized API responses before parsing them', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(' '.repeat(5_000_001)))
  await expect(new BmPartsClient({ apiKey: 'test' }, fetcher).sales(period, 1)).rejects.toThrow(
    'ліміт'
  )
})

it('sanitises network errors and rejects empty HTTP bodies', async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error('test-secret'))
  await expect(
    new BmPartsClient({ apiKey: 'test-secret' }, fetcher).sales(period, 1)
  ).rejects.not.toThrow('test-secret')
  fetcher.mockResolvedValue(new Response(null))
  await expect(new BmPartsClient({ apiKey: 'test' }, fetcher).sales(period, 1)).rejects.toThrow(
    'порожня'
  )
})
