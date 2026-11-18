import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Font } from '@react-pdf/renderer'

const fontsDir = path.join(process.cwd(), 'src/assets/fonts')

const dataUri = (file: string) =>
  `data:font/truetype;base64,${readFileSync(path.join(fontsDir, file)).toString('base64')}`

/**
 * Every family a document can use, embedded rather than named: react-pdf writes
 * the font file into the PDF, and the built-in PDF fonts are Latin-1 only,
 * which would drop Cyrillic on the floor.
 */
const FAMILIES = [
  { family: 'Roboto', regular: 'Roboto-Regular.ttf', bold: 'Roboto-Bold.ttf' },
  { family: 'Noto Serif', regular: 'NotoSerif-Regular.ttf', bold: 'NotoSerif-Bold.ttf' },
  { family: 'Noto Sans Mono', regular: 'NotoSansMono-Regular.ttf', bold: 'NotoSansMono-Bold.ttf' },
  { family: 'Open Sans', regular: 'OpenSans-Regular.ttf', bold: 'OpenSans-Bold.ttf' },
  { family: 'Lato', regular: 'Lato-Regular.ttf', bold: 'Lato-Bold.ttf' },
  { family: 'Montserrat', regular: 'Montserrat-Regular.ttf', bold: 'Montserrat-Bold.ttf' },
  { family: 'PT Sans', regular: 'PTSans-Regular.ttf', bold: 'PTSans-Bold.ttf' },
]

for (const { family, regular, bold } of FAMILIES) {
  const regularUri = dataUri(regular)
  const boldUri = dataUri(bold)
  Font.register({
    family,
    fonts: [
      { src: regularUri, fontWeight: 400 },
      { src: boldUri, fontWeight: 700 },
    ],
  })
  // A separate bold family, because the styles pick weight by family name.
  Font.register({ family: `${family}-Bold`, src: boldUri })
}

// Disable word hyphenation so Cyrillic text is not broken mid-word
Font.registerHyphenationCallback((word) => [word])

let preparation: Promise<void> | undefined

/**
 * Fontkit caches composite-glyph components without Unicode code points. If a
 * Cyrillic document is printed first, its components can poison later Latin
 * text (for example В/B and Н/H), leaving empty ToUnicode entries in the PDF.
 * Populate the character mapping before any subset is built. This runs once
 * per server process and covers each separately registered bold alias too.
 */
export function preparePdfFonts(): Promise<void> {
  preparation ??= Promise.all(
    FAMILIES.flatMap(({ family }) => [
      { fontFamily: family, fontWeight: 400 },
      { fontFamily: family, fontWeight: 700 },
      { fontFamily: `${family}-Bold`, fontWeight: 400 },
    ]).map(async (descriptor) => {
      await Font.load(descriptor)
      const font = Font.getFont(descriptor).data
      if (!font) throw new Error(`PDF font did not load: ${descriptor.fontFamily}`)
      for (const codePoint of font.characterSet) {
        // Leave presentation-form ligatures to the shaper: preloading ﬁ as a
        // single character would turn later "fi" text into U+FB01 on extraction.
        if (codePoint >= 0xfb00 && codePoint <= 0xfb06) continue
        const glyph = font.glyphForCodePoint(codePoint)
        if (glyph.codePoints.length === 0) glyph.codePoints = [codePoint]
      }
    })
  )
    .then(() => undefined)
    .catch((error) => {
      preparation = undefined
      throw error
    })
  return preparation
}
