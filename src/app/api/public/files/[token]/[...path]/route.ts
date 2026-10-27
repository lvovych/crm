import { NextRequest, NextResponse } from 'next/server'
import { svgDownloadHeaders } from '@/lib/upload-url'
import { db } from '@/lib/db'
import { readFile, stat } from 'fs/promises'
import path from 'path'
import { uploadsRoot } from '@/lib/upload-root'

const MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  pdf: 'application/pdf',
  csv: 'text/csv',
  txt: 'text/plain',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string; path: string[] }> }
) {
  const { token, path: segments } = await params

  // Expected: [category, filename]
  if (segments.length !== 2) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }

  const [category, filename] = segments

  // Every folder a shared document's images and attachments can live in. A
  // tire-hotel job's photos sat under its own folder, which this list did not
  // know, so its share link showed every image but those.
  const allowedCategories = [
    'vehicles',
    'inventory',
    'services',
    'logos',
    'quotes',
    'tire-hotel',
    'inspections',
    'documents',
  ]
  if (!allowedCategories.includes(category)) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
  }

  // Prevent directory traversal
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })
  }

  // A share token grants access to one document, never the entire workshop.
  const serviceRecord = await db.serviceRecord.findUnique({
    where: { publicToken: token },
    select: {
      organizationId: true,
      attachments: { where: { includeInInvoice: true }, select: { fileUrl: true } },
    },
  })
  const quote = serviceRecord
    ? null
    : await db.quote.findFirst({
        where: { publicToken: token },
        select: {
          organizationId: true,
          attachments: { where: { includeInInvoice: true }, select: { fileUrl: true } },
        },
      })
  const inspection =
    serviceRecord || quote
      ? null
      : await db.inspection.findFirst({
          where: { publicToken: token },
          select: {
            organizationId: true,
            attachments: { where: { includeInReport: true }, select: { fileUrl: true } },
            items: { select: { imageUrls: true } },
          },
        })
  const statusReport =
    serviceRecord || quote || inspection
      ? null
      : await db.statusReport.findFirst({
          where: { publicToken: token },
          select: { organizationId: true, videoUrl: true, expiresAt: true },
        })
  const orgId = (serviceRecord ?? quote ?? inspection ?? statusReport)?.organizationId
  if (!orgId || (statusReport?.expiresAt && statusReport.expiresAt <= new Date())) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const urls = [
    ...(serviceRecord?.attachments ?? []),
    ...(quote?.attachments ?? []),
    ...(inspection?.attachments ?? []),
  ].map((file) => file.fileUrl)
  urls.push(...(inspection?.items.flatMap((item) => item.imageUrls) ?? []))
  if (statusReport?.videoUrl) urls.push(statusReport.videoUrl)

  // Only configured document logos are public, not arbitrary files in logos/.
  if (category === 'logos') {
    const logos = await db.appSetting.findMany({
      where: {
        organizationId: orgId,
        key: {
          in: [
            'workshop.logo',
            'invoice.logo',
            'quote.logo',
            'certificate.logo',
            'work_order.logo',
          ],
        },
      },
      select: { value: true },
    })
    urls.push(...logos.map((logo) => logo.value))
  }
  const suffix = `${orgId}/${category}/${filename}`
  if (
    !urls.some((url) => url === `/api/protected/files/${suffix}` || url === `/api/files/${suffix}`)
  ) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const filePath = path.join(uploadsRoot(), orgId, category, filename)

  try {
    await stat(filePath)
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const buffer = await readFile(filePath)
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  if (ext === 'svg') {
    return new NextResponse(buffer, {
      headers: svgDownloadHeaders('private, no-store'),
    })
  }
  const contentType = MIME_TYPES[ext] || 'application/octet-stream'

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
