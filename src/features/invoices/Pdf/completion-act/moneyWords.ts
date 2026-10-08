const ones = ['', 'один', 'два', 'три', 'чотири', 'п’ять', 'шість', 'сім', 'вісім', 'дев’ять']
const teens = [
  'десять',
  'одинадцять',
  'дванадцять',
  'тринадцять',
  'чотирнадцять',
  'п’ятнадцять',
  'шістнадцять',
  'сімнадцять',
  'вісімнадцять',
  'дев’ятнадцять',
]
const tens = [
  '',
  '',
  'двадцять',
  'тридцять',
  'сорок',
  'п’ятдесят',
  'шістдесят',
  'сімдесят',
  'вісімдесят',
  'дев’яносто',
]
const hundreds = [
  '',
  'сто',
  'двісті',
  'триста',
  'чотириста',
  'п’ятсот',
  'шістсот',
  'сімсот',
  'вісімсот',
  'дев’ятсот',
]
function form(n: number, forms: string[]) {
  const last = n % 100
  return forms[last >= 11 && last <= 14 ? 2 : n % 10 === 1 ? 0 : n % 10 >= 2 && n % 10 <= 4 ? 1 : 2]
}
function group(n: number, feminine = false) {
  const words = [hundreds[Math.floor(n / 100)]]
  const tail = n % 100
  if (tail >= 10 && tail < 20) words.push(teens[tail - 10])
  else {
    words.push(tens[Math.floor(tail / 10)])
    words.push(
      feminine && tail % 10 === 1 ? 'одна' : feminine && tail % 10 === 2 ? 'дві' : ones[tail % 10]
    )
  }
  return words.filter(Boolean).join(' ')
}
/** Integer kopecks prevent a 99.995 rounding carry from producing "100 копійок". */
export function hryvniaWords(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0 || amount >= 1e12) throw new Error('Invalid act total')
  const kopecks = Math.round((amount + Number.EPSILON) * 100)
  const hryvnias = Math.floor(kopecks / 100)
  const words: string[] = []
  for (const [scale, forms, feminine] of [
    [1e9, ['мільярд', 'мільярди', 'мільярдів'], false],
    [1e6, ['мільйон', 'мільйони', 'мільйонів'], false],
    [1e3, ['тисяча', 'тисячі', 'тисяч'], true],
  ] as const) {
    const n = Math.floor(hryvnias / scale) % 1000
    if (n) words.push(group(n, feminine), form(n, [...forms]))
  }
  if (hryvnias % 1000) words.push(group(hryvnias % 1000, true))
  if (!hryvnias) words.push('нуль')
  words.push(
    form(hryvnias, ['гривня', 'гривні', 'гривень']),
    String(kopecks % 100).padStart(2, '0'),
    form(kopecks % 100, ['копійка', 'копійки', 'копійок'])
  )
  const text = words.join(' ')
  return text[0].toUpperCase() + text.slice(1)
}
