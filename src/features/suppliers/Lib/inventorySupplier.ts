export function assertLegacySupplierChange(
  current: {
    preferredSupplierId: string | null
    supplier: string | null
    supplierPhone: string | null
    supplierEmail: string | null
  },
  update: {
    preferredSupplierId?: string | null
    supplier?: string
    supplierPhone?: string
    supplierEmail?: string
  }
) {
  if (
    current.preferredSupplierId &&
    update.preferredSupplierId === undefined &&
    (['supplier', 'supplierPhone', 'supplierEmail'] as const).some(
      (k) => update[k] !== undefined && (update[k] || null) !== current[k]
    )
  ) {
    throw new Error(
      'This part has a linked supplier. Select or clear the preferred supplier before changing legacy details.'
    )
  }
}
