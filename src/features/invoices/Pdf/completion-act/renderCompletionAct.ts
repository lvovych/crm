import { renderToBuffer } from '@react-pdf/renderer'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { CompletionActPDF, type CompletionActProps } from './CompletionActPDF'

export async function renderCompletionAct(props: CompletionActProps): Promise<Uint8Array> {
  const rendered = await renderToBuffer(CompletionActPDF(props))
  const pdf = await PDFDocument.load(rendered)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const pages = pdf.getPages()
  for (const [index, page] of pages.entries()) {
    const label = `${index + 1} / ${pages.length}`
    page.drawText(label, {
      x: page.getWidth() - 30 - font.widthOfTextAtSize(label, 8),
      y: 20,
      size: 8,
      font,
      color: rgb(0.4, 0.4, 0.4),
    })
  }
  return pdf.save()
}
