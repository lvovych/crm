export type BrandLine = {
  name: string
  partNumber?: string | null
  inventoryPartId?: string | null
  brand?: string
}

/** An omitted field from an older client must not erase historical metadata. */
export function resolveBrandSnapshot(
  line: BrandLine,
  previous: BrandLine[] = [],
  inventoryBrand?: string
): string {
  if (line.brand !== undefined) return line.brand
  const matches = previous.filter(
    (old) =>
      old.name === line.name &&
      (old.partNumber || '') === (line.partNumber || '') &&
      (old.inventoryPartId || '') === (line.inventoryPartId || '')
  )
  const names = new Set(matches.map((old) => old.brand ?? '---'))
  if (names.size > 1)
    throw new Error('Ambiguous historical brand; reload the document before saving')
  return names.values().next().value ?? inventoryBrand ?? '---'
}
