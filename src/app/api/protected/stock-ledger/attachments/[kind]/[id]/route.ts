import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/with-auth'
import { db } from '@/lib/db'
import { PermissionAction as A, PermissionSubject as S } from '@/lib/permissions'
import {
  attachmentTarget,
  listAttachments,
  readAttachment,
  saveAttachment,
} from '@/features/stock-ledger/Lib/attachments'
import type { LedgerDB } from '@/features/stock-ledger/Lib/transaction'
type Params = { params: Promise<{ kind: string; id: string }> }
const ledgerDB = db as unknown as LedgerDB
export async function GET(request: Request, { params }: Params) {
  if (process.env.STOCK_LEDGER_ENABLED !== 'true') return new Response(null, { status: 404 })
  const parsed = attachmentTarget.safeParse(await params)
  if (!parsed.success) return new Response(null, { status: 404 })
  const target = parsed.data,
    fileId = new URL(request.url).searchParams.get('file')
  const permissions = [
    { action: A.READ, subject: target.kind === 'receipt' ? S.STOCK_LEDGER : S.SUPPLIER_FINANCE },
    ...(target.kind === 'payment' ? [] : [{ action: A.READ, subject: S.STOCK_COST }]),
  ]
  if (fileId) {
    const result = await withAuth((ctx) => readAttachment(ledgerDB, ctx, target, fileId), {
      requiredPermissions: permissions,
    })
    if (!result.success || !result.data)
      return NextResponse.json(
        { error: 'Файл недоступний' },
        { status: result.forbidden ? 403 : 404 }
      )
    return new Response(new Uint8Array(result.data.bytes), {
      headers: {
        'Content-Type': result.data.mimeType,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.data.name)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }
  const result = await withAuth((ctx) => listAttachments(ledgerDB, ctx, target), {
    requiredPermissions: permissions,
  })
  return NextResponse.json(result, {
    status: result.success ? 200 : result.forbidden ? 403 : 404,
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
export async function POST(request: Request, { params }: Params) {
  if (process.env.STOCK_LEDGER_ENABLED !== 'true') return new Response(null, { status: 404 })
  if (
    request.headers.get('origin') !== new URL(process.env.NEXT_PUBLIC_APP_URL || request.url).origin
  )
    return new Response(null, { status: 403 })
  const parsed = attachmentTarget.safeParse(await params)
  if (!parsed.success) return new Response(null, { status: 404 })
  const target = parsed.data
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
          size += r.value.length
          if (size > 11 * 1024 * 1024) {
            await reader.cancel()
            throw new Error('Файл перевищує 10 МБ')
          }
          chunks.push(r.value)
        }
      } finally {
        reader.releaseLock()
      }
      const form = await new Request(request.url, {
          method: 'POST',
          headers: { 'content-type': request.headers.get('content-type') ?? '' },
          body: Buffer.concat(chunks),
        }).formData(),
        file = form.get('file')
      if (!(file instanceof File)) throw new Error('Виберіть файл')
      return saveAttachment(ledgerDB, ctx, target, {
        name: file.name,
        bytes: Buffer.from(await file.arrayBuffer()),
        idempotencyKey: String(form.get('idempotencyKey')),
      })
    },
    {
      requiredPermissions: [
        {
          action: A.CREATE,
          subject: target.kind === 'receipt' ? S.STOCK_LEDGER : S.SUPPLIER_FINANCE,
        },
        ...(target.kind === 'payment' ? [] : [{ action: A.READ, subject: S.STOCK_COST }]),
      ],
    }
  )
  return NextResponse.json(result, { status: result.success ? 201 : result.forbidden ? 403 : 422 })
}
