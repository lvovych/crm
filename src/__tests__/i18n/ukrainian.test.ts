import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parse, type MessageFormatElement } from '@formatjs/icu-messageformat-parser'
import { IntlMessageFormat } from 'intl-messageformat'
import { locales, localeNames } from '@/i18n/config'
import { getBestLocaleFromHeader } from '@/i18n/locale-from-request'
import common from '../../../messages/uk/common.json'

vi.mock('@/lib/db', () => ({ db: {} }))

function strings(value: unknown, prefix = '', result: Record<string, string> = {}) {
  if (typeof value === 'string') result[prefix] = value
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) strings(child, `${prefix}.${key}`, result)
  }
  return result
}

// Compare the formatting contract, including nested plural/select branches and tags.
function contract(nodes: MessageFormatElement[]): unknown[] {
  return nodes.flatMap((node): unknown[] => {
    if (node.type === 0) return []
    if (node.type === 7) return [{ type: node.type }]
    if (node.type === 8)
      return [{ type: node.type, value: node.value, children: contract(node.children) }]
    if (node.type === 5 || node.type === 6) {
      return [
        {
          type: node.type,
          value: node.value,
          ...(node.type === 6 ? { offset: node.offset, pluralType: node.pluralType } : {}),
          options: Object.fromEntries(
            Object.entries(node.options).map(([key, option]) => [key, contract(option.value)])
          ),
        },
      ]
    }
    return [
      { type: node.type, value: node.value, ...('style' in node ? { style: node.style } : {}) },
    ]
  })
}

describe('Ukrainian localization', () => {
  it('is selectable under the correct language code', () => {
    expect(locales).toContain('uk')
    expect(localeNames.uk).toBe('Українська')
    expect(getBestLocaleFromHeader('uk-UA,uk;q=0.9,en;q=0.8')).toBe('uk')
  })

  for (const file of fs.readdirSync('messages/ru').filter((file) => file.endsWith('.json'))) {
    it(`preserves all keys and formatting contracts in ${file}`, () => {
      const ru = strings(JSON.parse(fs.readFileSync(path.join('messages/ru', file), 'utf8')))
      const uk = strings(JSON.parse(fs.readFileSync(path.join('messages/uk', file), 'utf8')))
      expect(Object.keys(uk).sort()).toEqual(Object.keys(ru).sort())
      for (const [key, source] of Object.entries(ru)) {
        expect(uk[key].trim(), `${file}${key} must not be empty`).not.toBe('')
        expect(contract(parse(uk[key])), `${file}${key}`).toEqual(contract(parse(source)))
      }
    })
  }

  it('formats Ukrainian plural categories', () => {
    const message = new IntlMessageFormat(common.upgrade.maxUsers, 'uk')
    for (const [limit, phrase] of [
      [1, '1 учасника'],
      [2, '2 учасників'],
      [5, '5 учасників'],
      [21, '21 учасника'],
    ] as const) {
      expect(message.format({ limit })).toContain(phrase)
    }
  })
})
