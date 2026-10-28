import { NextResponse, after } from 'next/server'
import { withAuth } from '@/lib/with-auth'
import { PermissionAction as A, PermissionSubject as S } from '@/lib/permissions'
import { db } from '@/lib/db'
import { enqueueImport, runImportTasks } from '@/features/stock-ledger/Lib/importQueue'
import type { PrismaClient } from '@/generated/prisma/client'
import type { LedgerDB } from '@/features/stock-ledger/Lib/transaction'
import { importMappingSchema } from '@/features/stock-ledger/Lib/imports'
export async function POST(request: Request) {
  if (process.env.STOCK_LEDGER_ENABLED !== 'true')
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Cookie-authenticated upload must originate from this application.
  const allowedOrigin = new URL(process.env.NEXT_PUBLIC_APP_URL || request.url).origin
  if (request.headers.get('origin') !== allowedOrigin)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const result = await withAuth(
    async (ctx) => {
      const reader = request.body?.getReader()
      if (!reader) throw new Error('Порожній файл')
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        for (;;) {
          const r = await reader.read()
          if (r.done) break
          size += r.value.byteLength
          if (size > 11 * 1024 * 1024) {
            await reader.cancel()
            throw new Error('Файл перевищує 10 МБ')
          }
          chunks.push(r.value)
        }
      } finally {
        reader.releaseLock()
      }
      const bounded = new Request(request.url, {
        method: 'POST',
        headers: { 'content-type': request.headers.get('content-type') ?? '' },
        body: Buffer.concat(chunks),
      })
      const form = await bounded.formData(),
        file = form.get('file')
      if (!(file instanceof File)) throw new Error('Виберіть файл')
      const format = file.name.toLowerCase().endsWith('.xlsx')
        ? 'xlsx'
        : file.name.toLowerCase().endsWith('.csv')
          ? 'csv'
          : null
      if (!format) throw new Error('Підтримуються CSV і XLSX')
      const mapping = importMappingSchema.parse(JSON.parse(String(form.get('mapping'))))
      const task = await enqueueImport(db as unknown as LedgerDB, ctx, {
        supplierId: String(form.get('supplierId')),
        name: file.name,
        format,
        bytes: Buffer.from(await file.arrayBuffer()),
        mapping,
      })
      after(() => runImportTasks(db as unknown as PrismaClient, task.id))
      return task
    },
    {
      requiredPermissions: [
        { action: A.CREATE, subject: S.STOCK_LEDGER },
        { action: A.READ, subject: S.STOCK_COST },
      ],
    }
  )
  return NextResponse.json(result, { status: result.success ? 202 : result.forbidden ? 403 : 422 })
}
