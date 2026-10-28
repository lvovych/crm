'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getPartyPeriodStatement } from '../Actions/ledgerActions'
export function PartyStatement({
  partyId,
  name,
  through,
}: {
  partyId: string
  name: string
  through: string
}) {
  const [open, setOpen] = useState(false),
    [from, setFrom] = useState(through.slice(0, 7) + '-01'),
    [end, setEnd] = useState(through),
    [data, setData] = useState<Awaited<ReturnType<typeof getPartyPeriodStatement>>['data']>(),
    [error, setError] = useState(''),
    [page, setPage] = useState(1)
  useEffect(() => {
    let live = true
    if (open && from && end) {
      setData(undefined)
      getPartyPeriodStatement({ partyId, from, through: end }).then((r) => {
        if (live) {
          setData(r.data)
          setError(r.error ?? '')
          setPage(1)
        }
      })
    }
    return () => {
      live = false
    }
  }, [open, from, end, partyId])
  function download() {
    if (!data) return
    const url = URL.createObjectURL(
        new Blob(['\uFEFF' + data.csv], { type: 'text/csv;charset=utf-8' })
      ),
      a = document.createElement('a')
    a.href = url
    a.download = `statement-${from}-${end}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Акт звірки
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Звірка: {name}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              Початок періоду
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label>
              Кінець періоду
              <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
          </div>
          {error && <p role="alert">{error}</p>}
          {data ? (
            <>
              <p>
                Початкове сальдо: {data.opening} грн · Кінцеве: {data.closing} грн
              </p>
              <p>
                Нараховано: {data.debit} грн · Зменшення й оплати: {data.credit} грн
              </p>
              <Button onClick={download}>Завантажити акт CSV</Button>
              {data.rows.slice((page - 1) * 25, page * 25).map((r) => (
                <div key={r.id} className="grid gap-1 rounded border p-2 sm:grid-cols-4">
                  <strong>
                    {r.date} · {r.document}
                  </strong>
                  <span>Нараховано: {r.debit || '0.00'}</span>
                  <span>Зменшення: {r.credit || '0.00'}</span>
                  <span>Сальдо: {r.balance}</span>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                  Назад
                </Button>
                <span>{page}</span>
                <Button
                  disabled={page * 25 >= data.rows.length}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Далі
                </Button>
              </div>
            </>
          ) : (
            !error && <p role="status">Завантаження звірки…</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
