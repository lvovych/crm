/** Data shared by every entry point that opens the new work-order picker. */
export interface VehiclePickerOption {
  id: string
  make: string
  model: string
  year: number
  licensePlate: string | null
  vin?: string | null
  customer: { id: string; name: string; company: string | null; phone?: string | null } | null
}

const text = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘ʼ`]/g, "'")
const compact = (value: string) => text(value).replace(/[\s\-–—]/g, '')
const plateLetters: Record<string, string> = {
  а: 'a',
  в: 'b',
  е: 'e',
  і: 'i',
  к: 'k',
  м: 'm',
  н: 'h',
  о: 'o',
  р: 'p',
  с: 'c',
  т: 't',
  х: 'x',
}
const plate = (value: string) =>
  compact(value).replace(/[авеікмнорстх]/g, (letter) => plateLetters[letter])
const phoneDigits = (value: string) => {
  const digits = value.replace(/\D/g, '')
  // Only canonicalize a complete Ukrainian international number, not arbitrary suffixes.
  return digits.length === 12 && digits.startsWith('380') ? digits.slice(2) : digits
}

/**
 * Every query term must match this vehicle or its owner. Adjacent phone fragments
 * may form one term (e.g. +380 (67) 123-45-67), but unrelated numeric terms are
 * never joined across a name. Phone-only matches require at least four digits.
 * No fetching or mutation: callers retain their organization/permission filtering.
 */
export function matchesVehiclePickerSearch(vehicle: VehiclePickerOption, query: string): boolean {
  if (!query.trim()) return true
  const words = text(query)
    .trim()
    .split(/\s+/)
    .filter((word) => !/^[+()\-–—]+$/.test(word))
  if (!words.length) return false
  const fields = [
    vehicle.make,
    vehicle.model,
    String(vehicle.year),
    vehicle.customer?.name ?? '',
  ].map(text)
  const registration = plate(vehicle.licensePlate ?? '')
  const vin = compact(vehicle.vin ?? '')
  const phone = phoneDigits(vehicle.customer?.phone ?? '')
  const matchesWord = (word: string) =>
    fields.some((field) => field.includes(word)) ||
    (!!plate(word) && registration.includes(plate(word))) ||
    (!!compact(word) && vin.includes(compact(word)))

  // Dynamic programming avoids exponential backtracking on long pasted queries.
  const matched = new Array<boolean>(words.length + 1).fill(false)
  matched[words.length] = true
  for (let start = words.length - 1; start >= 0; start--) {
    if (matchesWord(words[start]) && matched[start + 1]) {
      matched[start] = true
      continue
    }
    let fragments = ''
    for (let end = start; end < words.length; end++) {
      if (!/^[\d+()\-–—]+$/.test(words[end])) break
      fragments += words[end]
      const digits = phoneDigits(fragments)
      if (digits.length > Math.max(phone.length, 12)) break
      if (digits.length >= 4 && phone.endsWith(digits) && matched[end + 1]) {
        matched[start] = true
        break
      }
    }
  }
  return matched[0]
}
