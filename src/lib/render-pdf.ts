import { renderToBuffer as render } from '@react-pdf/renderer'
import { preparePdfFonts } from '@/features/vehicles/Components/invoice-pdf/fonts'

/** All server PDF writers share the same Unicode-safe font preparation. */
export async function renderToBuffer(...args: Parameters<typeof render>) {
  await preparePdfFonts()
  return render(...args)
}
