import { hasPermission, PermissionAction as A, PermissionSubject as S } from '@/lib/permissions'
export function ledgerCapabilities(
  admin: boolean,
  permissions: { action: string; subject: string }[]
) {
  const can = (action: A, subject: S) => admin || hasPermission(permissions, { action, subject }),
    stock = can(A.READ, S.STOCK_LEDGER),
    cost = can(A.READ, S.STOCK_COST),
    finance = can(A.READ, S.SUPPLIER_FINANCE)
  return {
    admin,
    stock,
    cost,
    finance,
    draft: can(A.CREATE, S.STOCK_LEDGER),
    post: can(A.POST, S.STOCK_LEDGER),
    adjust: can(A.ADJUST, S.STOCK_LEDGER),
    financeDraft: can(A.CREATE, S.SUPPLIER_FINANCE),
    financePost: can(A.POST, S.SUPPLIER_FINANCE),
    allocate: can(A.ALLOCATE, S.SUPPLIER_FINANCE),
    financeReverse: can(A.REVERSE, S.SUPPLIER_FINANCE),
    sections: {
      receipts: stock && cost,
      editor: stock && cost,
      overview: stock,
      stock: stock && cost,
      demands: stock,
      purchases: stock && cost,
      counts: stock && cost,
      import: stock && cost && can(A.CREATE, S.STOCK_LEDGER),
      report: finance && cost,
      finances: finance,
      directories: admin,
      administration: admin,
    },
  }
}
