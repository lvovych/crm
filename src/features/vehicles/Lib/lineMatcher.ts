/** Stable one-to-one matching, including repeated legacy rows without IDs. */
export function lineMatcher<T extends { id: string }>(rows: T[], key: (row: T) => string) {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const buckets = new Map<string, { rows: T[]; next: number }>()
  const used = new Set<string>()
  for (const row of rows) {
    const k = key(row)
    const bucket = buckets.get(k)
    if (bucket) bucket.rows.push(row)
    else buckets.set(k, { rows: [row], next: 0 })
  }
  return (id: string | undefined, legacyKey: string): T | undefined => {
    let row: T | undefined
    if (id) row = byId.get(id)
    else {
      const bucket = buckets.get(legacyKey)
      while (bucket && bucket.next < bucket.rows.length) {
        const candidate = bucket.rows[bucket.next++]
        if (!used.has(candidate.id)) {
          row = candidate
          break
        }
      }
    }
    if (!row || used.has(row.id)) return undefined
    used.add(row.id)
    return row
  }
}
