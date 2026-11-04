// Preserve meaningful prefixes, punctuation and leading zeros.
export function articleKey(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, '').toUpperCase()
}
type CatalogPart = {
  id: string
  partNumber: string | null
  supplierArticles: { supplierId: string; normalized: string }[]
}
export function matchArticle<T extends CatalogPart>(parts: T[], supplier: string, article: string) {
  const key = articleKey(article)
  if (!key || !supplier) return []
  const mapped = parts.filter((p) =>
    p.supplierArticles.some((a) => a.supplierId === supplier && a.normalized === key)
  )
  return mapped.length
    ? mapped
    : parts.filter((p) => p.partNumber && articleKey(p.partNumber) === key)
}
