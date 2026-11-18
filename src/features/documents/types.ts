export const documentTypes = {
  receipt: 'Прихідні накладні',
  return: 'Повернення постачальникам',
  order: 'Наряди / рахунки клієнтам',
  finance: 'Касові та банківські документи',
  supplier: 'Розрахунки з постачальниками',
  payment: 'Оплати клієнтів',
  salary: 'Нарахування зарплати SAL',
} as const
export type DocumentType = keyof typeof documentTypes
export type DocumentScope = {
  organizationId: string
  receipts: boolean
  orders: boolean
  finance: boolean
  settlements: boolean
  payroll: boolean
  accounts: string[]
}
export type JournalRow = {
  key: string
  type: DocumentType
  id: string
  label: string
  party: string
  date: string
  amount: string
  status: string
  href: string
  note: string
}
export type DocumentEdge = { source: string; target: string; relation: string }
export const documentStatus: Record<string, string> = {
  posted: 'Проведено',
  draft: 'Чернетка',
  new: 'Новий',
  completed: 'Завершено',
  cancelled: 'Скасовано',
  reversed: 'Сторновано',
  pending: 'Очікує',
  'in-progress': 'У роботі',
  in_progress: 'У роботі',
  planned: 'Заплановано',
  scheduled: 'Заплановано',
  waiting_parts: 'Очікує запчастин',
  waiting: 'Очікування',
}
export function documentUrl(row: Pick<JournalRow, 'type' | 'id'>) {
  return '/documents/' + row.type + '/' + encodeURIComponent(row.id)
}
