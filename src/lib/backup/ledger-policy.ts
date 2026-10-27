import { FULL_DATABASE_MODELS } from './manifest'

export const FULL_BACKUP_REQUIRED =
  'Ledger requires a full database and files backup. Use scripts/full-backup.py; partial JSON export/restore is not supported.'

type Reader = { findFirst(args: { where: { organizationId: string; key?: { startsWith: string }; OR?: Array<Record<string, string>> }; select: { id: true } }): Promise<unknown> }

export function containsLedgerData(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  if (row.inventoryAccountingMode === 'LEDGER' || row.financeAccountingMode === 'LEDGER') return true
  if (typeof row.key === 'string' && row.key.startsWith('stockLedger.approved')) return true
  if ('ledger' in row) return true
  return Object.values(row).some(containsLedgerData)
}

/** Refuse before any deletion. Never weaken immutable ledger triggers to import JSON. */
export async function requiresFullBackup(client: unknown, organizationId: string, data?: unknown) {
  if (containsLedgerData(data)) return true
  const readers = client as Record<string, Reader>
  for (const model of FULL_DATABASE_MODELS) {
    const delegate = model[0].toLowerCase() + model.slice(1)
    if (await readers[delegate].findFirst({ where: { organizationId }, select: { id: true } })) return true
  }
  if (await readers.serviceRecord.findFirst({
    where: { organizationId, OR: [{ inventoryAccountingMode: 'LEDGER' }, { financeAccountingMode: 'LEDGER' }] },
    select: { id: true },
  })) return true
  return !!(await readers.appSetting.findFirst({
    where: { organizationId, key: { startsWith: 'stockLedger.approved' } },
    select: { id: true },
  }))
}
