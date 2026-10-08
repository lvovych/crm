// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { hryvniaWords } from '@/features/invoices/Pdf/completion-act/moneyWords'

describe('Ukrainian act amounts', () => {
  it.each([
    [0, 'Нуль гривень 00 копійок'],
    [1.01, 'Одна гривня 01 копійка'],
    [2.02, 'Дві гривні 02 копійки'],
    [11.11, 'Одинадцять гривень 11 копійок'],
    [21.25, 'Двадцять одна гривня 25 копійок'],
    [16200, 'Шістнадцять тисяч двісті гривень 00 копійок'],
    [2002, 'Дві тисячі дві гривні 00 копійок'],
    [1000001, 'Один мільйон одна гривня 00 копійок'],
    [99.999, 'Сто гривень 00 копійок'],
  ])('prints %s without losing currency gender or kopecks', (amount, expected) => {
    expect(hryvniaWords(amount)).toBe(expected)
  })
  it('rejects invalid totals instead of printing misleading money', () => {
    for (const amount of [-1, NaN, Infinity, 1e12]) expect(() => hryvniaWords(amount)).toThrow()
  })
})
