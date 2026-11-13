import { Fragment } from 'react'
import type { SlipLine } from './calculation'

export function Lines({ lines }: { lines: SlipLine[] }) {
  const groups = new Map<string, SlipLine[]>()
  for (const line of lines) {
    const key = [line.order, line.car].filter(Boolean).join(' · ') || 'Інші складові'
    const group = groups.get(key)
    if (group) group.push(line)
    else groups.set(key, [line])
  }
  return (
    <div className="overflow-x-auto">
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
