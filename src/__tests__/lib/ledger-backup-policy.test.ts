import { describe, expect, it, vi } from 'vitest'
import { FULL_DATABASE_MODELS } from '@/lib/backup/manifest'
import { containsLedgerData, requiresFullBackup } from '@/lib/backup/ledger-policy'
import { readFileSync } from 'node:fs'

function empty() {
  return Object.fromEntries([...FULL_DATABASE_MODELS, 'AppSetting', 'ServiceRecord'].map((model) => [
    model[0].toLowerCase() + model.slice(1), { findFirst: vi.fn(async () => null) },
  ]))
}

describe('ledger uses full database disaster recovery', () => {
  it('allows legacy JSON backup only when no ledger rows or cutover exist', async () => {
    expect(await requiresFullBackup(empty(), 'org')).toBe(false)
  })
  it.each(FULL_DATABASE_MODELS)('refuses JSON replacement when %s contains data', async (model) => {
    const client = empty()
    client[model[0].toLowerCase() + model.slice(1)].findFirst.mockResolvedValue({ id: 'row' } as never)
    expect(await requiresFullBackup(client, 'org')).toBe(true)
  })
  it('refuses imported cutover and ledger documents even into a legacy organization', async () => {
    expect(containsLedgerData({ vehicles: [{ serviceRecords: [{ financeAccountingMode: 'LEDGER' }] }] })).toBe(true)
    expect(containsLedgerData({ settings: [{ key: 'stockLedger.approvedCutover.v1' }] })).toBe(true)
    expect(await requiresFullBackup({}, 'org', { ledger: {} })).toBe(true)
  })
  it('scopes every read to the importing organization', async () => {
    const client = empty()
    await requiresFullBackup(client, 'org')
    for (const reader of Object.values(client)) {
      expect(reader.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org' }) }))
    }
  })
  it('refuses a ledger work order even before its first posting', async () => {
    const client = empty()
    client.serviceRecord.findFirst.mockResolvedValue({ id: 'job' } as never)
    expect(await requiresFullBackup(client, 'org')).toBe(true)
  })
  it('fails closed when an active model delegate is missing', async () => {
    const client = empty()
    delete client.supplier
    await expect(requiresFullBackup(client, 'org')).rejects.toThrow()
  })
  it('fails closed on database errors', async () => {
    const client = empty()
    client.supplier.findFirst.mockRejectedValue(new Error('offline'))
    await expect(requiresFullBackup(client, 'org')).rejects.toThrow('offline')
  })
  it('refuses partial import before any destructive clearing', () => {
    const source = readFileSync('src/app/api/protected/backup/import/route.ts', 'utf8')
    expect(source.indexOf('requiresFullBackup(tx')).toBeLessThan(source.indexOf('const clearable'))
  })
  it('full backup discovers all tables rather than maintaining another ledger allowlist', () => {
    const source = readFileSync('scripts/full-backup.py', 'utf8')
    expect(source).toContain("FROM pg_tables WHERE schemaname='public'")
    expect(source).toContain("'--single-transaction'")
  })
})
