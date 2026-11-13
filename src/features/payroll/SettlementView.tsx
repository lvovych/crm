import { randomUUID } from 'node:crypto'
import { Lines } from './Lines'
import type { SlipLine } from './calculation'
import Link from 'next/link'
import { settlementData, payEmployee } from '@/features/payroll/settlements'
import { cents, decimal } from '@/features/finance/money'

export default async function SettlementView({
  searchParams,
}: {
  searchParams: Promise<{ employee?: string; slip?: string }>
}) {
  const r = await settlementData()
  if (!r.data) return <p>{r.error}</p>
  const { people, accounts, categories, canPay } = r.data
  const { employee, slip } = await searchParams
  const format = (value: bigint) => decimal(value).replace('.', ',')
  const person = people.find((p) => p.id === employee)
  return (
    <main className="mx-auto max-w-5xl space-y-5 p-6">
      <h1 className="text-3xl font-semibold">Взаєморозрахунки з працівниками</h1>
      {!person && (
        <table className="w-full tabular-nums">
          <thead><tr><th className="py-2 text-left">Ім’я</th><th className="text-right">До виплати</th></tr></thead>
          <tbody>{people.map(p => {
            const earned = p.paySlips.filter(s => s.status === 'completed').reduce((sum, slip) => sum + cents(slip.total.toFixed(2)), BigInt(0))
            const balance = p.staffPayments.reduce((sum, payment) =>
              payment.document.reversal ? sum : sum - cents(payment.document.amount.toFixed(2)), earned)
            return <tr key={p.id} className="border-t">
              <td className="py-2"><Link href={'?employee=' + p.id} className="underline">{p.name}</Link></td>
              <td className="text-right">{format(balance)} грн</td>
            </tr>
          })}</tbody>
        </table>
      )}
      {person && (
        <section className="space-y-3">
          <Link className="underline" href="/employee-settlements">Усі працівники</Link>
          <h2 className="text-xl font-semibold">{person.name}</h2>
          <Link className="underline" href={'/payroll?employee=' + person.id}>
            Нарахувати зарплату
          </Link>
          <h3 className="font-semibold">Розрахункові листки</h3>
          {!person.paySlips.length && <p>Проведених листків ще немає.</p>}
          {person.paySlips.filter(s => s.status === 'completed').reverse().map(s => {
            const credited = s.allocations.reduce((sum, a) => sum + cents(a.amount.toFixed(2)), BigInt(0))
            return <details open={slip === s.id} id={'slip-' + s.id} key={s.id} className="rounded border p-3">
              <summary className="cursor-pointer">
                {s.start.toLocaleDateString('uk-UA', {timeZone:'UTC'})} — {s.end.toLocaleDateString('uk-UA', {timeZone:'UTC'})}
                {' · Нараховано '}{format(cents(s.total.toFixed(2)))} грн
                {' · Зараховано виплат '}{format(credited)} грн
                {' · Залишок '}{format(cents(s.total.toFixed(2)) - credited)} грн
              </summary>
              <Lines lines={s.lines as unknown as SlipLine[]} />
              {s.allocations.map(a => {
                const payment = person.staffPayments.find(p => p.id === a.paymentId)!
                return <p key={a.id}>{payment.document.date.toLocaleDateString('uk-UA', {timeZone:'UTC'})}
                  {' · '}{payment.advance ? 'Аванс' : 'Виплата'} · {format(cents(a.amount.toFixed(2)))} грн</p>
              })}
            </details>
          })}
          <h3 className="font-semibold">Історія виплат та авансів</h3>
          {person.staffPayments.map((p) => (
            <details key={p.id}>
              <summary>
                {p.document.date.toISOString().slice(0, 10)} · {p.advance ? 'Аванс' : 'Виплата'} ·{' '}
                {p.document.amount.toFixed(2)} грн {p.document.reversal ? '· Сторновано' : ''}
              </summary>
              Документ {p.documentId}
              {p.allocations.map((a) => (
                <p key={a.id}>
                  Листок{' '}
                  {person.paySlips
                    .find((s) => s.id === a.slipId)
                    ?.start.toISOString()
                    .slice(0, 10)}{' '}
                  · {a.amount.toFixed(2)} грн
                </p>
              ))}
            </details>
          ))}
          {canPay && (
            <form id="payment"
              action={payEmployee}
              className="flex flex-wrap items-center gap-3 rounded border p-4"
            >
              <input type="hidden" name="employee" value={person.id} />
              <input type="hidden" name="requestId" value={randomUUID()} />
              <select name="type" aria-label="Операція">
                <option value="payment">Виплата</option>
                <option value="advance">Аванс</option>
              </select>
              <input
                name="amount"
                aria-label="Сума"
                placeholder="Сума, грн"
                type="number"
                min=".01"
                step=".01"
                required
              />
              <input name="date" defaultValue={r.data.today} type="date" aria-label="Дата" required />
              <select name="account" required>
                <option value="">Каса / банк</option>
                {accounts
                  .filter((a) => !a.isArchived)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
              <select name="category" required>
                <option value="">Стаття витрат</option>
                {categories.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button className="rounded border px-3 py-1">Провести виплату</button>
            </form>
          )}
        </section>
      )}
    </main>
  )
}
