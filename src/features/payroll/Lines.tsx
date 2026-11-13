import { Fragment } from 'react'
import type { SlipLine } from './calculation'

export type SlipDetails = SlipLine[] | { lines: SlipLine[]; conditions: string[] }
export function Lines({ details }: { details: SlipDetails }) {
  const lines = Array.isArray(details) ? details : details.lines
  const groups = new Map<string, SlipLine[]>()
  for (const line of lines) {
    const key = [line.order, line.car].filter(Boolean).join(' · ') || 'Інші складові'
    const group = groups.get(key)
    if (group) group.push(line)
    else groups.set(key, [line])
  }
  return (
    <div className="overflow-x-auto">
      {!Array.isArray(details) && <section className="mb-4">
        <h3 className="font-semibold">Умови на момент нарахування</h3>
        {details.conditions.length ? <ul className="list-disc pl-5">{details.conditions.map(c => <li key={c}>{c}</li>)}</ul> : <p>Активних правил немає.</p>}
      </section>}
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            {['Робота або складова', 'Ставка', 'База, грн', 'Нараховано, грн'].map((c) => (
              <th className="p-2" key={c}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from(groups, ([title, items]) => (
            <Fragment key={title}>
              <tr className="bg-muted">
                <th className="p-2" colSpan={4}>
                  {title}
                </th>
              </tr>
              {items.map((l, i) => (
                <tr className="border-b" key={i}>
                  <td className="p-2">{l.name}</td>
                  <td>{l.rate}</td>
                  <td>{l.base}</td>
                  <td>{l.amount}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
