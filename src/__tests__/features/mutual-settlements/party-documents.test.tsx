import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PartyDocuments } from '@/features/mutual-settlements/PartyDocuments'

const report = vi.hoisted(() => vi.fn())
vi.mock('@/features/mutual-settlements/actions', () => ({ mutualSettlementsReport: report }))
afterEach(cleanup)

it.each(['customer', 'supplier'] as const)('opens the %s documents on the selected date', async kind => {
  const document = {
    id: 'doc1', label: 'Документ 12', href: '/receipts/doc1', amount: '120.00',
    paid: null, debt: '120.00', advance: '0.00', expected: '0.00',
  }
  const party = { id: 'party1', kind, documents: [document] }
  report.mockResolvedValue({ data: {
    parties: kind === 'supplier' ? [party] : [],
    trackedParties: kind === 'customer' ? [party] : [], asOf: '2026-11-16',
  } })
  render(await PartyDocuments({ id: 'party1', kind, date: '2026-11-16' }))
  expect(report).toHaveBeenCalledWith('2026-11-16', { id: 'party1', kind })
  expect(screen.getByRole('article', { name: document.label })).toBeVisible()
  expect(screen.getByRole('link', { name: 'Відкрити документ' })).toHaveAttribute('href', document.href)
})
