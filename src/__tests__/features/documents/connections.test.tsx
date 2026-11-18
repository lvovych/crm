import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('@/features/documents/actions', () => ({ documentDetail: vi.fn() }))
import { DocumentConnections } from '@/features/documents/RelatedDocuments'
import type { JournalRow } from '@/features/documents/types'
afterEach(cleanup)
const receipt: JournalRow = {
  key: 'receipt:r',
  type: 'receipt',
  id: 'r',
  label: 'Накладна № 100',
  party: 'Постачальник',
  amount: '1000.00',
  date: '2026-11-18',
  status: 'posted',
  href: '/receipts/r',
  note: '',
}
it('renders exact amounts, relation and navigable documents', () => {
  render(
    <DocumentConnections
      root={receipt.key}
      documents={[
        receipt,
        {
          ...receipt,
          key: 'return:ret',
          type: 'return',
          id: 'ret',
          label: 'Повернення № 1',
          amount: '450.00',
        },
      ]}
      edges={[{ source: 'receipt:r', target: 'return:ret', relation: 'Повернення з накладної' }]}
    />
  )
  expect(screen.getByRole('link', { name: 'Накладна № 100' })).toHaveAttribute(
    'href',
    '/documents/receipt/r'
  )
  expect(screen.getByRole('link', { name: 'Повернення № 1' })).toHaveAttribute(
    'href',
    '/documents/return/ret'
  )
  expect(screen.getByText('Повернення з накладної')).toBeVisible()
  expect(screen.getByText(/450,00/)).toBeVisible()
})
it('explains empty results and truncated graphs', () => {
  render(<DocumentConnections root={receipt.key} documents={[]} edges={[]} truncated />)
  expect(screen.getByText(/доступних для вашої ролі/)).toBeVisible()
  expect(screen.getByRole('status')).toHaveTextContent('100')
})

it('groups multiple relations between the same documents without duplicate cards', () => {
  render(
    <DocumentConnections
      root={receipt.key}
      documents={[
        receipt,
        { ...receipt, key: 'return:r2', type: 'return', id: 'r2', label: 'Return' },
      ]}
      edges={[
        { source: receipt.key, target: 'return:r2', relation: 'Повернення з накладної' },
        { source: receipt.key, target: 'return:r2', relation: 'Зараховано 100.00 грн' },
      ]}
    />
  )
  expect(screen.getAllByRole('link', { name: 'Return' })).toHaveLength(1)
  expect(screen.getByText('Зараховано 100,00 грн')).toBeVisible()
})
