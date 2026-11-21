/** Resolve existing order assignments without treating the order's author as a mechanic. */
export type PayrollPerson = { id: string; name: string }
type LaborAssignment = {
  technicianId: string | null
  executorName?: string | null
  executorFrozen?: boolean
  pricingType?: string
  subcontract: unknown
}
export type ExecutorResolution = {
  technicianId: string | null
  executorLabel: string | null
  assignmentSource: string | null
  assignmentIssue: string | null
}
export function resolveExecutor(
  labor: LaborAssignment,
  order: { technicianId?: string | null },
  people: PayrollPerson[]
): ExecutorResolution {
  const empty = {
    technicianId: null,
    executorLabel: null,
    assignmentSource: null,
    assignmentIssue: null,
  }
  if (labor.subcontract || labor.pricingType === 'shopFee') return empty
  const found = (person: PayrollPerson, source: string): ExecutorResolution => ({
    technicianId: person.id,
    executorLabel: labor.executorName || person.name,
    assignmentSource: source,
    assignmentIssue: null,
  })
  if (labor.technicianId) {
    const person = people.find((p) => p.id === labor.technicianId)
    return person
      ? found(person, 'Виконавець роботи')
      : { ...empty, assignmentIssue: 'Виконавець роботи не належить до цього сервісу.' }
  }
  if (labor.executorFrozen) {
    // Closed lines show their frozen name in the order UI. Never replace that
    // historical assignment with a different mechanic from today's order header.
    const name = labor.executorName?.trim()
    const matches = name ? people.filter((p) => p.name.trim() === name) : []
    if (matches.length === 1) return found(matches[0], 'Виконавець, зафіксований при закритті')
    return {
      ...empty,
      executorLabel: name || null,
      assignmentIssue:
        matches.length > 1
          ? `Кілька працівників мають ім’я «${name}». Уточніть виконавця роботи.`
          : name
            ? `Не знайдено працівника «${name}». Уточніть виконавця роботи.`
            : 'При закритті роботи виконавця не зафіксовано.',
    }
  }
  const inherited = people.find((p) => p.id === order.technicianId)
  return inherited
    ? found(inherited, 'Основний механік наряду')
    : { ...empty, assignmentIssue: 'Виконавця роботи не призначено.' }
}
