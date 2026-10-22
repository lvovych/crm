import type { LaborPresetOption } from '../Components/LaborPresetPickerDialog'
import { lineTotal } from '@/features/inventory/Lib/partPricing'

export function normalizeLaborSearch(value: string) {
  return value
    .toLocaleLowerCase()
    .normalize('NFKC')
    .replace(/[’'`ʼ]/g, '')
    .replace(/масл\S*/gu, 'олив')
    .replace(/замен\S*/gu, 'заміна')
    .replace(/фильтр\S*/gu, 'фільтр')
    .replace(/\s+/g, ' ')
    .trim()
}
export function searchLaborPresets(
  presets: LaborPresetOption[],
  query: string,
  favorites: string[],
  recent: string[]
) {
  const words = normalizeLaborSearch(query).split(' ').filter(Boolean)
  return presets
    .filter((p) => {
      const haystack = normalizeLaborSearch(
        [p.name, p.description, ...p.items.map((i) => i.description)].join(' ')
      )
      return words.every((word) => haystack.includes(word))
    })
    .sort((a, b) => {
      const score = (p: LaborPresetOption) =>
        (favorites.includes(p.id) ? 100 : 0) +
        (recent.includes(p.id) ? 50 - recent.indexOf(p.id) : 0)
      return score(b) - score(a) || a.name.localeCompare(b.name)
    })
}
export function isLaborPackage(preset: LaborPresetOption) {
  return preset.items.length !== 1 || !!preset.parts?.length
}
export function laborPresetTotal(preset: LaborPresetOption) {
  return (
    preset.items.reduce((sum, i) => sum + lineTotal(i.hours, i.rate), 0) +
    (preset.parts ?? []).reduce((sum, p) => sum + lineTotal(p.quantity, p.unitPrice), 0)
  )
}
export function parseLaborNumber(value: string): number | null {
  if (!value.trim()) return null
  const n = Number(value.replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? n : null
}
