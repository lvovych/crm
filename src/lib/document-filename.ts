/** A shared, header-safe filename for all copies of a work-order document. */
export function documentFilename(
  kind: 'invoice' | 'complete_work',
  record: { invoiceNumber: string | null; id: string }
): string {
  const number =
    (record.invoiceNumber?.trim() || record.id)
      .normalize('NFC')
      .replace(/[\p{Cc}/\\:"<>|?*]/gu, '_')
      .replace(/^[. ]+|[. ]+$/g, '')
      .slice(0, 100)
      .replace(/\p{Cs}/gu, '_') || 'document'
  return `${kind}-${number}.pdf`
}

/** ASCII fallback plus RFC 5987 for Cyrillic and other Unicode order numbers. */
export function pdfDisposition(
  filename: string,
  disposition: 'inline' | 'attachment' = 'attachment'
): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, '_')
  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  )
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

export function downloadFilename(header: string | null, fallback = 'document.pdf'): string {
  const encoded = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  if (encoded) {
    try {
      return decodeURIComponent(encoded)
    } catch {
      /* Fall back to the quoted name. */
    }
  }
  return header?.match(/filename="([^"]+)"/i)?.[1] || fallback
}
