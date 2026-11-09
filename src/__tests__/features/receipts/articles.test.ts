import { describe, expect, it } from 'vitest'
import { matchArticle } from '@/features/receipts/articles'
const filter = {
  id: 'filter',
  partNumber: '0012345',
  supplierArticles: [
    { supplierId: 'b', normalized: 'FE0012345' },
    { supplierId: 'b', normalized: 'FB-12345' },
  ],
}
const other = { id: 'other', partNumber: 'FE0012345', supplierArticles: [] }
describe('receipt article matching', () => {
  it('finds the shared article even before choosing a supplier and disambiguates brands', () => {
    const a = { ...filter, brandId: 'a' },
      b = { ...filter, id: 'b', brandId: 'b' }
    expect(matchArticle([a], '', '0012345')).toEqual([a])
    expect(matchArticle([a, b], '', '0012345', 'b')).toEqual([b])
    expect(matchArticle([a, b], '', '0012345', 'missing')).toEqual([])
  })
  it('resolves several supplier articles to one part, preserving supplier precedence', () => {
    for (const code of ['fe 0012345', 'FB-12345'])
      expect(matchArticle([filter, other], 'b', code)).toEqual([filter])
    expect(matchArticle([filter, other], 'a', 'fe 0012345')).toEqual([other])
    expect(matchArticle([filter, other], 'a', '0012345')).toEqual([filter])
  })
  it('keeps competing brands ambiguous and preserves significant digits and prefixes', () => {
    const another = { ...filter, id: 'another-brand' }
    expect(matchArticle([filter, another], 'a', '0012345')).toHaveLength(2)
    for (const code of ['12345', '9990012345', '', 'FE 12345'])
      expect(matchArticle([filter], 'a', code)).toEqual([])
  })
})
