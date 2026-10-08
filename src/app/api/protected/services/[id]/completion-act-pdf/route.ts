import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/get-auth-context'
import { withAuth } from '@/lib/with-auth'
import { PermissionAction, PermissionSubject } from '@/lib/permissions'
import { db } from '@/lib/db'
import { buildCompletionActPdfBuffer } from '@/features/invoices/Pdf/buildCompletionActPdfBuffer'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getAuthContext()))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const result = await withAuth(
    async ({ organizationId }) => {
      const owned = await db.serviceRecord.findFirst({
        where: { id, organizationId },
        select: { id: true },
      })
      return owned ? buildCompletionActPdfBuffer(owned.id) : null
    },
    {
      requiredPermissions: [{ action: PermissionAction.READ, subject: PermissionSubject.SERVICES }],
    }
  )
  if (!result.success)
    return NextResponse.json({ error: result.error }, { status: result.forbidden ? 403 : 500 })
  if (!result.data) return NextResponse.json({ error: 'Record not found' }, { status: 404 })
  const { buffer, filename } = result.data
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
