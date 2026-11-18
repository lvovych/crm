// @vitest-environment node
import React from 'react'
import { Document, type DocumentProps, Page, Text } from '@react-pdf/renderer'
import { extractText } from 'unpdf'
import { describe, expect, it } from 'vitest'
import { renderToBuffer } from '@/lib/render-pdf'

describe('PDF text after a Cyrillic document', () => {
  it('keeps Latin component glyphs searchable across consecutive renders', async () => {
    for (const text of ['ВН Україна', 'BILL TO VEHICLE UAH 3 400,00 UAH Hours refill office']) {
      const document: React.ReactElement<DocumentProps> = (
        <Document>
          <Page>
            <Text style={{ fontFamily: 'Roboto-Bold' }}>{text}</Text>
            <Text style={{ fontFamily: 'Roboto', fontWeight: 700 }}>{text}</Text>
          </Page>
        </Document>
      )
      const buffer = await renderToBuffer(document)
      const extracted = await extractText(new Uint8Array(buffer), { mergePages: true })
      expect(extracted.text).toBe(`${text}\n${text}`)
    }
  })
})
