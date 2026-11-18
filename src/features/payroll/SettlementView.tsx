import { getOperationText } from '@/i18n/operation-text.server'
import { randomUUID } from 'node:crypto'
import { Lines } from './Lines'
import type { SlipDetails } from './Lines'
import Link from 'next/link'
import { settlementData, payEmployee } from '@/features/payroll/settlements'
import { cents, decimal } from '@/features/finance/money'

export default async function SettlementView({
  searchParams,
}: {
  searchParams: Promise<{ employee?: string; slip?: string; from?: string; to?: string }>
}) {
  const ot = await getOperationText()

  const query = await searchParams
  const r = await settlementData(query)
  if (!r.data) return <p>{r.error}</p>
  const { people, person, period, accounts, categories, canPay } = r.data
  const { slip } = query
  const format = (value: bigint) => decimal(value).replace('.', ',')
  return (
    <main className="ops-workspace mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
      <h1 className="text-3xl font-semibold">{ot('Взаєморозрахунки з працівниками')}</h1>
      {!person && (
        <table className="w-full tabular-nums">
          <thead>
            <tr>
              <th className="py-2 text-left">{ot('Ім’я')}</th>
              <th className="text-right">{ot('До виплати')}</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const balance = cents(p.balance)
              return (
                <tr key={p.id} className="border-t">
                  <td className="py-2">
                    <Link href={'?employee=' + p.id} className="underline">
                      {p.name}
                    </Link>
                  </td>
                  <td className="text-right">
                    {format(balance)} {ot(" грн")}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {person && (
        <section className="space-y-3">
          <Link className="underline" href="/employee-settlements">
            {ot('Усі працівники')}
          </Link>
          <h2 className="text-xl font-semibold">{person.name}</h2>
          <Link className="underline" href={'/payroll?employee=' + person.id}>
            {ot('Нарахувати зарплату')}
          </Link>
          <form className="flex flex-wrap gap-3">
            <input type="hidden" name="employee" value={person.id} />
            <label>
              {ot("Від ")}
              <input type="date" name="from" defaultValue={period.from} required />
            </label>
            <label>
              {ot("До ")}
              <input type="date" name="to" defaultValue={period.to} required />
            </label>
            <button className="underline">{ot('Показати період')}</button>
          </form>
          <p>
            {ot('Загальний залишок:')}{' '}
            {format(cents(people.find((p) => p.id === person.id)?.balance ?? '0'))}{' '}
            {ot(" грн. Нижче — документи за обраний період.")}
          </p>
          <h3 className="font-semibold">{ot('Розрахункові листки')}</h3>
          {!person.paySlips.length && <p>{ot('Проведених листків ще немає.')}</p>}
          {person.paySlips
            .filter((s) => s.status === 'completed')
            .reverse()
            .map((s) => {
              const credited = s.allocations.reduce(
                (sum, a) => sum + cents(a.amount.toFixed(2)),
                BigInt(0)
              )
              return (
                <details open={slip === s.id} id={'slip-' + s.id} key={s.id} className="ops-panel">
                  <summary className="cursor-pointer">
                    {s.start.toLocaleDateString('uk-UA', { timeZone: 'UTC' })} —{' '}
                    {s.end.toLocaleDateString('uk-UA', { timeZone: 'UTC' })}
                    {ot(" · Нараховано ")}
                    {format(cents(s.total.toFixed(2)))} {ot(" грн")}
                    {ot(" · Зараховано виплат ")}
                    {format(credited)} {ot(" грн")}
                    {ot(" · Залишок ")}
                    {format(cents(s.total.toFixed(2)) - credited)} {ot(" грн")}
                  </summary>
                  <Lines details={s.lines as unknown as SlipDetails} />
                  {s.allocations.map((a) => {
                    const payment = a.payment
                    return (
                      <p key={a.id}>
                        {payment.document.date.toLocaleDateString('uk-UA', { timeZone: 'UTC' })}
                        {' · '}
                        {payment.advance ? ot('Аванс') : ot('Виплата')} ·{' '}
                        {format(cents(a.amount.toFixed(2)))} {ot(" грн")}
                      </p>
                    )
                  })}
                </details>
              )
            })}
          <h3 className="font-semibold">{ot('Історія виплат та авансів')}</h3>
          {person.staffPayments.map((p) => (
            <details key={p.id}>
              <summary>
                {p.document.date.toISOString().slice(0, 10)} ·{' '}
                {p.advance ? ot('Аванс') : ot('Виплата')} · {p.document.amount.toFixed(2)}{' '}
                {ot(" грн ")}
                {p.document.reversal ? ot('· Сторновано') : ''}
              </summary>
              {ot("Документ ")}
              {p.documentId}
              {p.allocations.map((a) => (
                <p key={a.id}>
                  {ot("Листок ")}
                  {a.slip.start.toISOString().slice(0, 10)} · {a.amount.toFixed(2)} {ot(" грн")}
                </p>
              ))}
            </details>
          ))}
          {canPay && (
            <form id="payment" action={payEmployee} className="ops-form ops-panel">
              <input type="hidden" name="employee" value={person.id} />
              <input type="hidden" name="requestId" value={randomUUID()} />
              <label>
                {ot('Операція')}
                <select name="type" aria-label={ot('Операція')}>
                  <option value="payment">{ot('Виплата')}</option>
                  <option value="advance">{ot('Аванс')}</option>
                </select>
              </label>
              <label>
                {ot('Сума, грн')}
                <input
                  name="amount"
                  aria-label={ot('Сума')}
                  placeholder={ot('Сума, грн')}
                  type="number"
                  min=".01"
                  step=".01"
                  required
                />
              </label>
              <label>
                {ot('Дата операції')}
                <input
                  name="date"
                  defaultValue={r.data.today}
                  type="date"
                  aria-label={ot('Дата')}
                  required
                />
              </label>
              <label>
                {ot('Каса / рахунок')}
                <select name="account" required>
                  <option value="">{ot('Каса / банк')}</option>
                  {accounts
                    .filter((a) => !a.isArchived)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                {ot('Стаття витрат')}
                <select name="category" required>
                  <option value="">{ot('Стаття витрат')}</option>
                  {categories.map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <button className="min-h-11 rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground">
                {ot('Провести виплату')}
              </button>
            </form>
          )}
        </section>
      )}
    </main>
  )
}
