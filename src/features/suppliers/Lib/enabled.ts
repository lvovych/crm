/** Opt-in per workshop; disabling never deletes existing directory records. */
export function supplierDirectoryEnabled(organizationId: string): boolean {
  const allowed = (process.env.SUPPLIER_DIRECTORY_ORGANIZATIONS ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
  return allowed.includes('*') || allowed.includes(organizationId)
}
export function assertSupplierDirectoryEnabled(organizationId: string) {
  if (!supplierDirectoryEnabled(organizationId))
    throw new Error('Supplier directory is not enabled for this workshop')
}
