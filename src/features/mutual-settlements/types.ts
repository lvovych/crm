import type { LedgerEvent } from '@/features/customer-ledger/projection'
export type DocumentRow = {
  id: string
  label: string
  href: string
  date: string | null
  due: string | null
  amount: string | null
  paid: string | null
  debt: string
  advance: string
  expected: string
  reason: string | null
  provisional: boolean
  history?: LedgerEvent[]
}
export type PartyRow = {
  id: string
  name: string
  phone: string
  kind: 'customer' | 'supplier'
  archived: boolean
  debt: string
  advance: string
  overdue: string
  expected: string
  documents: DocumentRow[]
}
export type Overview = {
  today: string
  asOf: string
  customersAllowed: boolean
  suppliersAllowed: boolean
  customersHistoricalUnavailable: boolean
  supplierError: string | null
  parties: PartyRow[]
  trackedParties?: PartyRow[]
}
