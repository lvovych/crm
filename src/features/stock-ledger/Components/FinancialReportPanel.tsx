'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getFinancialReport } from '../Actions/ledgerActions'
type Report = NonNullable<Awaited<ReturnType<typeof getFinancialReport>>['data']>
export function FinancialReportPanel() {
  const [through, setThrough] = useState(() =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date())
    ),
    [data, setData] = useState<Report>(),
    [error, setError] = useState('')
  useEffect(() => {
    let live = true
    if (through)
      getFinancialReport({ through }).then((r) => {
        if (live) {
          setData(r.data)
          setError(r.error ?? '')
        }
      })
    return () => {
      live = false
    }
  }, [through])
  function download() {
    if (!data) return
    const cell = (s: string) =>
      '"' + (/^[=+\-@\t\r]/.test(s) ? "'" + s : s).replaceAll('"', '""') + '"'
    const rows = [
      ['Дата', 'Облік', 'Назва', 'Борг', 'Аванс', 'Баланс / вартість'],
      ...data.parties.map((p) => [data.through, p.side, p.name, p.debt, p.advance, p.balance]),
      ...data.cash.map((c) => [data.through, 'Каса / рахунок', c.name, '', '', c.balance]),
      ...data.stock.map((s) => [data.through, 'Склад', s.name, '', '', s.cost]),
    ]
    const url = URL.createObjectURL(
      new Blob(['\uFEFF' + rows.map((r) => r.map(cell).join(';')).join('\r\n')], {
        type: 'text/csv;charset=utf-8',
      })
    )
    const a = document.createElement('a')
    a.href = url
    a.download = `balances-${through}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <section className="grid gap-4 [&_button]:min-h-11 [&_input]:min-h-11">
      <h2 className="text-xl">Залишки й розрахунки на дату</h2>
      <p>Дані нового журналу. Історичні залишки CRM потраплять сюди після звіреного перенесення.</p>
      <label className="max-w-xs">
        Включно до
        <Input type="date" value={through} onChange={(e) => setThrough(e.target.value)} />
      </label>
      {error && <p role="alert">{error}</p>}
      <Button disabled={!data} onClick={download}>
        Завантажити CSV
      </Button>
      {data?.errors.map((e) => (
        <p key={e} role="alert">
          {e}
        </p>
      ))}
      <h3 className="text-lg">Контрагенти</h3>
      {data?.parties.map((p) => (
        <article key={p.side + p.id} className="grid gap-2 rounded border p-3 sm:grid-cols-4">
          <strong>
            {p.name}
            <br />
            {p.side === 'AP' ? 'Постачальник' : 'Клієнт'}
          </strong>
          <span>Борг: {p.debt} грн</span>
          <span>Аванс: {p.advance} грн</span>
          <span>Сальдо: {p.balance} грн</span>
        </article>
      ))}
      <h3 className="text-lg">Каси та рахунки</h3>
      {data?.cash.map((c) => (
        <p key={c.id}>
          {c.name}: {c.balance} грн
        </p>
      ))}
      <h3 className="text-lg">Собівартість залишків</h3>
      {data?.stock.map((s) => (
        <p key={s.id}>
          {s.name}: {s.cost} грн
        </p>
      ))}
    </section>
  )
}
