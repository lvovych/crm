import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { PermissionAction as A, PermissionSubject as S } from '@/lib/permissions'
import { readImportOriginal } from '@/features/stock-ledger/Lib/importQueue'
import type { PrismaClient } from '@/generated/prisma/client'
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.STOCK_LEDGER_ENABLED !== 'true') return new Response(null, { status: 404 })
  const { id } = await params,
    result = await withAuth((ctx) => readImportOriginal(db as unknown as PrismaClient, ctx, id), {
      requiredPermissions: [
        { action: A.READ, subject: S.STOCK_LEDGER },
        { action: A.READ, subject: S.STOCK_COST },
      ],
    })
  if (!result.success || !result.data)
    return NextResponse.json(
      { error: 'Файл недоступний' },
      { status: result.forbidden ? 403 : 404 }
    )
  return new Response(new Uint8Array(result.data.bytes), {
    headers: {
      'Content-Type':
        result.data.format === 'csv'
          ? 'text/csv; charset=utf-8'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.data.name)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
