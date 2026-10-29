export interface CatalogEngine {
  name: string
  displacementCc: number | null
}
export interface CatalogGeneration {
  name: string
  from: number | null
  to: number | null
  engines: CatalogEngine[]
}
export interface CatalogMake {
  name: string
  models: { name: string; generations: CatalogGeneration[] }[]
}

// MVS registration colours, not manufacturer paint names/codes.
export const REGISTRATION_COLORS = [
  'black',
  'blue',
  'green',
  'beige',
  'red',
  'purple',
  'orange',
  'yellow',
  'white',
  'brown',
  'gray',
] as const

export function catalogSearch(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .trim()
}
