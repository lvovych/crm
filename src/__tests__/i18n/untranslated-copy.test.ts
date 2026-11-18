import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

// Product names, protocol identifiers, fonts, sample addresses and display-only
// interpolation patterns legitimately have the same spelling in all languages.
// New prose must be translated, not added to this exception list.
const neutral = new Set([
  '-{value}',
  'APK',
  'Account SID',
  'Arial',
  'BRK-001',
  'CSV',
  'Client ID',
  'Courier',
  'Courier New',
  'Ctrl+K',
  'Ctrl+Shift+L',
  'EU-kontroll, kontrollinstruks 4.1',
  'Email',
  'GST',
  'Georgia',
  'Google Meet',
  'HIN',
  'HIN: {vin}',
  'HSN',
  'HSN/TSN',
  'HSN/TSN: {typeKey}',
  'HTML',
  'Hauptuntersuchung (§29 StVZO)',
  'Messaging service SID',
  'Michelin, Bridgestone, Nokian',
  'Microsoft Teams',
  'PDF',
  'PRO',
  'SMS',
  'TPMS',
  'TSN',
  'Telegram',
  'Times Roman',
  'Torq Pro',
  'Torqvoice',
  'Trebuchet MS',
  'User Agent',
  'VIN',
  'VIN:',
  'VIN: {vin}',
  'Verdana',
  'WhatsApp',
  'Zoom',
  'https://supplier.com/product/...',
  'mg.yourdomain.com',
  'noreply@example.com',
  'noreply@yourdomain.com',
  'service@example.com',
  'smtp.example.com',
  'us-east-1',
  'user@example.com',
  'you@example.com',
  '{done}/{total}',
  '{price}/{interval}',
  '{start} — {end}',
  '{used} / {limit}',
])

type Messages = { [key: string]: string | Messages }
it.each(['uk', 'ru'])('%s has no English prose copied into its catalogs', (locale) => {
  const missing: string[] = []
  function compare(english: Messages, translated: Messages, prefix: string) {
    for (const [key, value] of Object.entries(english)) {
      const translation = translated[key]
      if (typeof value === 'object') {
        compare(value, translation as Messages, `${prefix}.${key}`)
      } else if (value === translation && /[A-Za-z]{3}/.test(value) && !neutral.has(value)) {
        missing.push(`${prefix}.${key}: ${value}`)
      }
    }
  }
  for (const file of fs.readdirSync('messages/en').filter((name) => name.endsWith('.json'))) {
    compare(
      JSON.parse(fs.readFileSync(path.join('messages/en', file), 'utf8')),
      JSON.parse(fs.readFileSync(path.join('messages', locale, file), 'utf8')),
      file
    )
  }
  expect(missing).toEqual([])
})
