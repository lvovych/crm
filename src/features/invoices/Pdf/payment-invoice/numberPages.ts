import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

/** Number the final pages after wrapping, including attachment pages. */
export async function numberInvoicePages(buffer: Uint8Array): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(buffer)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const pages = pdf.getPages()
  for (const [index, page] of pages.entries()) {
    const label = `${index + 1} / ${pages.length}`
    page.drawText(label, {
      x: page.getWidth() - 28 - font.widthOfTextAtSize(label, 7),
      y: 17,
      size: 7,
      font,
      color: rgb(0.4, 0.4, 0.4),
    })
  }
  return pdf.save()
}
