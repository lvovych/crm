import { describe, it, expect } from 'vitest'
import { ledgerCapabilities } from '@/features/stock-ledger/Lib/capabilities'
import { PermissionAction as A, PermissionSubject as S } from '@/lib/permissions'
describe('ledger navigation capabilities', () => {
  it('does not show forbidden panels or use manage as a wildcard', () => {
    const empty = ledgerCapabilities(false, [])
    expect(Object.values(empty.sections).every((v) => !v)).toBe(true)
    const finance = ledgerCapabilities(false, [{ action: A.READ, subject: S.SUPPLIER_FINANCE }])
    expect(finance.sections.finances).toBe(true)
    expect(finance.sections.receipts).toBe(false)
    expect(finance.financePost).toBe(false)
    const stock = ledgerCapabilities(false, [
      { action: A.READ, subject: S.STOCK_LEDGER },
      { action: A.RESERVE, subject: S.STOCK_LEDGER },
    ])
    expect(stock.sections.overview).toBe(true)
    expect(stock.sections.demands).toBe(true)
    expect(stock.sections.receipts).toBe(false)
    expect(
      ledgerCapabilities(false, [{ action: A.MANAGE, subject: S.SUPPLIER_FINANCE }]).allocate
    ).toBe(false)
  })
  it('keeps draft, posting and allocation separate while owners can operate all sections', () => {
    const owner = ledgerCapabilities(true, [])
    expect(Object.values(owner.sections).every(Boolean)).toBe(true)
    const draft = ledgerCapabilities(false, [
      { action: A.READ, subject: S.STOCK_LEDGER },
      { action: A.READ, subject: S.STOCK_COST },
      { action: A.CREATE, subject: S.STOCK_LEDGER },
    ])
    expect(draft.sections.import).toBe(true)
    expect(draft.post).toBe(false)
    const post = ledgerCapabilities(false, [{ action: A.POST, subject: S.SUPPLIER_FINANCE }])
    expect(post.financePost).toBe(true)
    expect(post.financeDraft).toBe(false)
    expect(post.allocate).toBe(false)
  })
})
