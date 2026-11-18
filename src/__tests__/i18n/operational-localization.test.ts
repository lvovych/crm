import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { operationText } from '@/i18n/operations'
import { locales, defaultLocale, supportedLocale } from '@/i18n/config'
import { DEFAULT_CURRENCY_CODE } from '@/lib/currencies'
import { DEFAULT_TIME_FORMAT } from '@/lib/format'
import uk from '../../../messages/uk/operations.json'
import en from '../../../messages/en/operations.json'
import ru from '../../../messages/ru/operations.json'

describe('operational localization', () => {
  it('defaults to Ukrainian, hryvnia and 24-hour time and rejects removed locales', () => {
    expect(locales).toEqual(['uk', 'ru', 'en'])
    expect(defaultLocale).toBe('uk')
    expect(DEFAULT_CURRENCY_CODE).toBe('UAH')
    expect(DEFAULT_TIME_FORMAT).toBe('24h')
    expect(supportedLocale('de')).toBe('uk')
    expect(supportedLocale('ru')).toBe('ru')
    expect(supportedLocale(undefined)).toBe('uk')
  })
  it('translates application labels, preserves spacing and leaves user data untouched', () => {
    expect(operationText('en')('Каси та рахунки')).toBe('Cash and bank accounts')
    expect(operationText('ru')('Каси та рахунки')).toBe('Кассы и счета')
    expect(operationText('uk')('Cash and bank accounts')).toBe('Каси та рахунки')
    expect(operationText('en')(' грн')).toBe(' UAH')
    expect(operationText('en')('ТОВ Моя майстерня')).toBe('ТОВ Моя майстерня')
    expect(operationText('en')(undefined)).toBe('')
  })
  it('has complete, nonempty translations for every operational label', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(uk).sort())
    expect(Object.keys(ru).sort()).toEqual(Object.keys(uk).sort())
    for (const dictionary of [uk, en, ru]) {
      expect(Object.values(dictionary).every((text) => text.trim().length > 0)).toBe(true)
    }
  })
  it('resolves every static operation translation call in application code', () => {
    const known = new Set([...Object.values(uk), ...Object.values(en)])
    const missing: string[] = []
    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (!['__tests__', 'generated'].includes(entry.name)) walk(file)
        } else if (/\.tsx?$/.test(file)) {
          const text = fs.readFileSync(file, 'utf8')
          if (!/\bot\s*\(/.test(text)) continue
          const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
          function visit(node: ts.Node) {
            if (
              ts.isCallExpression(node) &&
              ts.isIdentifier(node.expression) &&
              node.expression.text === 'ot'
            ) {
              const first = node.arguments[0]
              if (
                first &&
                ts.isStringLiteral(first) &&
                !known.has(first.text.trim().replace(/\s+/g, ' '))
              )
                missing.push(file + ': ' + first.text)
            }
            ts.forEachChild(node, visit)
          }
          visit(source)
        }
      }
    }
    walk('src')
    expect(missing).toEqual([])
  })
})
