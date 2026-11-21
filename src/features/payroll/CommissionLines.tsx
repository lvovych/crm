import { cents, decimal } from '@/features/finance/money'
import Link from 'next/link'
import type { CommissionDetails, CommissionLine } from './commission-calculator'

export const payrollMoney = (n: string | number) =>
  new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Number(n)
  )
export function CommissionLines({ details, zone }: { details: CommissionDetails; zone: string }) {
  const groups = new Map<string, CommissionLine[]>()
  for (const line of details.lines)
    groups.set(line.orderId, [...(groups.get(line.orderId) ?? []), line])
  const sum = (lines: CommissionLine[]) =>
    lines.reduce((s, l) => s + Math.round(Number(l.amount) * 100), 0) / 100
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">За що нараховано зарплату</h2>
        <p className="text-sm text-muted-foreground">
          Кожна робота або запчастина — окремим рядком. База без ПДВ.
        </p>
      </div>
      {!!details.warnings?.length && (
        <div role="alert" className="rounded-lg border border-amber-500/40 p-4 text-sm">
          <p className="font-semibold">
            Роботи без однозначного виконавця не враховані в зарплаті механіків.
          </p>
          <ul className="mt-2 list-inside list-disc">
            {details.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
      {!details.lines.length && (
        <p className="rounded-lg border border-dashed p-8 text-center">
          За цей період немає нарахувань. Перевірте правила, призначення працівників і дати закриття
          нарядів.
        </p>
      )}
      {[...groups].map(([id, lines]) => (
        <details key={id} open className="overflow-hidden rounded-lg border bg-card">
          <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <b>Наряд № {lines[0].order}</b>
              <span className="ml-3 text-sm text-muted-foreground">{lines[0].car}</span>
              <p className="mt-1 text-xs text-muted-foreground">
                Закрито{' '}
                {new Intl.DateTimeFormat('uk-UA', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                  timeZone: zone,
                }).format(new Date(lines[0].closedAt))}
              </p>
            </div>
            <strong>{payrollMoney(sum(lines))} грн</strong>
          </summary>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-y bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="p-3">Робота / запчастина</th>
                  <th className="p-3 text-right">База, грн</th>
                  <th className="p-3 text-right">Ставка</th>
                  <th className="p-3 text-right">Нараховано, грн</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.lineId + l.plan + i} className="border-b last:border-0">
                    <td className="min-w-48 p-3">
                      {l.name}
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {l.kind === 'labor' ? 'Робота' : 'Запчастина'} · {l.ruleName} · з{' '}
                        {l.effective}
                      </span>
                      {l.executorLabel && (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {l.executorLabel} · {l.assignmentSource}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {payrollMoney(l.base)}
                      <span className="block whitespace-nowrap text-xs text-muted-foreground">
                        {payrollMoney(l.sale)} − {payrollMoney(l.cost)} витрати
                      </span>
                    </td>
                    <td className="p-3 text-right tabular-nums">{l.rate}</td>
                    <td className="p-3 text-right font-semibold tabular-nums">
                      {payrollMoney(l.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lines[0].vehicleId && (
            <Link
              className="block border-t p-3 text-xs underline"
              href={`/vehicles/${lines[0].vehicleId}/service/${id}`}
            >
              Відкрити наряд
            </Link>
          )}
        </details>
      ))}
      {!!details.adjustments?.length && (
        <section className="space-y-3 rounded-lg border p-4" aria-label="Премії та утримання">
          <h3 className="font-semibold">Премії та утримання</h3>
          {details.adjustments.map((row) => (
            <div key={row.id} className="flex justify-between gap-4 border-t pt-3">
              <div className="min-w-0 break-words">
                <p className="font-medium">{row.type === 'bonus' ? 'Премія' : 'Утримання'}</p>
                <p className="text-sm text-muted-foreground">{row.reason}</p>
              </div>
              <span className="shrink-0 tabular-nums">
                {row.type === 'bonus' ? '+' : '−'}
                {payrollMoney(row.amount)} грн
              </span>
            </div>
          ))}
        </section>
      )}
      <div className="flex flex-wrap justify-between gap-6 pt-3">
        <p className="max-w-md text-sm text-muted-foreground">
          Проведення фіксує позиції, правила та суми. Виплата оформлюється окремо.
        </p>
        <dl className="min-w-64 space-y-3 rounded-lg border bg-card p-5">
          <div className="flex justify-between gap-8 text-sm">
            <dt>За роботи</dt>
            <dd>{payrollMoney(sum(details.lines.filter((l) => l.kind === 'labor')))} грн</dd>
          </div>
          <div className="flex justify-between gap-8 text-sm">
            <dt>За запчастини</dt>
            <dd>{payrollMoney(sum(details.lines.filter((l) => l.kind === 'parts')))} грн</dd>
          </div>
          {!!details.adjustments?.length &&
            (['bonus', 'deduction'] as const).map((type) => (
              <div key={type} className="flex justify-between gap-8 text-sm">
                <dt>{type === 'bonus' ? 'Премії' : 'Утримання'}</dt>
                <dd>
                  {type === 'bonus' ? '+' : '−'}
                  {payrollMoney(
                    decimal(
                      details
                        .adjustments!.filter((row) => row.type === type)
                        .reduce((sum, row) => sum + cents(row.amount), BigInt(0))
                    )
                  )}{' '}
                  грн
                </dd>
              </div>
            ))}
          <div className="flex items-center justify-between gap-8 border-t pt-3">
            <dt>Усього нараховано</dt>
            <dd className="text-xl font-semibold tabular-nums">
              {payrollMoney(details.total)} грн
            </dd>
          </div>
        </dl>
      </div>
    </div>
  )
}
