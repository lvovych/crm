export function receiptsEnabled(org: string) {
  const allowed = (process.env.SUPPLIER_RECEIPT_ORGANIZATIONS ?? '').split(',').map((s) => s.trim())
  return allowed.includes('*') || allowed.includes(org)
}
