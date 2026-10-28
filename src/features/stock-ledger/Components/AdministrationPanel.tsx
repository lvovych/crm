'use client'
import { MigrationManager } from './MigrationManager'
import { ProviderAccounts } from './ProviderAccounts'
import { useEffect, useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  getLedgerAdministration,
  getLedgerReconciliation,
  closeAccountingPeriod,
  reopenAccountingPeriod,
  postOpeningBalance,
  postOpeningStock,
  searchLedgerProducts,
} from '../Actions/ledgerActions'
type Data = NonNullable<Awaited<ReturnType<typeof getLedgerAdministration>>['data']>
export function AdministrationPanel() {
  const [data, setData] = useState<Data>(),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [mode, setMode] = useState('AP'),
    [partyId, setParty] = useState(''),
    [accountId, setAccount] = useState(''),
    [polarity, setPolarity] = useState('DEBIT'),
    [amount, setAmount] = useState(''),
    [date, setDate] = useState(''),
    [note, setNote] = useState(''),
    [through, setThrough] = useState(''),
    [area, setArea] = useState('BOTH'),
    [periodAction, setPeriodAction] = useState('close'),
    [reason, setReason] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [check, setCheck] = useState<Awaited<ReturnType<typeof getLedgerReconciliation>>['data']>(),
    [warehouseId, setWarehouse] = useState(''),
    [query, setQuery] = useState(''),
    [products, setProducts] = useState<
      NonNullable<Awaited<ReturnType<typeof searchLedgerProducts>>['data']>
    >([]),
    [productId, setProduct] = useState(''),
    [quantity, setQuantity] = useState(''),
    [price, setPrice] = useState('')
  useEffect(() => {
    let live = true
    getLedgerAdministration(page).then((r) => {
      if (live) {
        setData(r.data)
        setError(r.error ?? '')
      }
    })
    return () => {
      live = false
    }
  }, [page, revision])
  useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      if (query.trim())
        searchLedgerProducts(query).then((r) => {
          if (live) setProducts(r.data ?? [])
        })
    }, 200)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [query])
  const operationKeys = useRef(new Map<string, string>())
  function commandKey(values: unknown[]) {
    const fingerprint = JSON.stringify(values)
    let key = operationKeys.current.get(fingerprint)
    if (!key) {
      key = crypto.randomUUID()
      operationKeys.current.set(fingerprint, key)
    }
    return key
  }
  async function run(fn: () => Promise<{ success: boolean; error?: string }>) {
    setBusy(true)
    setError('')
    try {
      const r = await fn()
      if (!r.success) setError(r.error ?? 'Помилка')
      else {
        setRevision((v) => v + 1)
        setAmount('')
        setConfirmed(false)
        setError('Збережено')
      }
    } catch {
      setError('Не вдалося отримати відповідь. Повторіть запит: він захищений від дублювання.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="grid gap-6 [&_input]:min-h-11 [&_button]:min-h-11 [&_select]:min-h-11 [&_select]:rounded [&_select]:border [&_select]:bg-background [&_select]:p-2">
      <ProviderAccounts />
      <MigrationManager />
      {error && <p role="status">{error}</p>}
      {!data ? (
        <p>Завантаження адміністративних даних…</p>
      ) : (
        <>
          <form
            className="grid max-w-2xl gap-3 rounded border p-4"
            onSubmit={(e) => {
              e.preventDefault()
              run(() =>
                postOpeningBalance({
                  idempotencyKey: commandKey([
                    'balance',
                    mode,
                    partyId,
                    accountId,
                    polarity,
                    amount,
                    date,
                    note,
                  ]),
                  ...(mode === 'CASH' ? { accountId } : { partyId, side: mode, polarity }),
                  amount,
                  effectiveAt: date,
                  sourceNote: note,
                  batchKey: commandKey([
                    'balance',
                    mode,
                    partyId,
                    accountId,
                    polarity,
                    amount,
                    date,
                    note,
                  ]),
                })
              )
            }}
          >
            <h2 className="text-xl">Початковий фінансовий баланс</h2>
            <p>
              Вносьте лише звірені залишки. Запис одразу проводиться; не дублюйте вже перенесений
              баланс.
            </p>
            <label>
              Облік
              <select
                className="w-full"
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value)
                  setParty('')
                }}
              >
                <option value="AP">Постачальник</option>
                <option value="AR">Клієнт</option>
                <option value="CASH">Каса / рахунок</option>
              </select>
            </label>
            {mode === 'CASH' ? (
              <label>
                Рахунок
                <select
                  required
                  className="w-full"
                  value={accountId}
                  onChange={(e) => setAccount(e.target.value)}
                >
                  <option value="">Виберіть рахунок</option>
                  {data.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <>
                <label>
                  Контрагент
                  <select
                    required
                    className="w-full"
                    value={partyId}
                    onChange={(e) => setParty(e.target.value)}
                  >
                    <option value="">Виберіть контрагента</option>
                    {data.parties
                      .filter((p) => p.kind === (mode === 'AP' ? 'SUPPLIER' : 'CUSTOMER'))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.displayNameSnapshot}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Вид залишку
                  <select
                    className="w-full"
                    value={polarity}
                    onChange={(e) => setPolarity(e.target.value)}
                  >
                    <option value="DEBIT">
                      Борг {mode === 'AP' ? 'постачальнику' : 'клієнта'}
                    </option>
                    <option value="CREDIT">
                      Аванс {mode === 'AP' ? 'постачальнику' : 'від клієнта'}
                    </option>
                  </select>
                </label>
              </>
            )}
            <label>
              Сума, грн
              <Input
                required
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(',', '.'))}
              />
            </label>
            <label>
              Дата залишку
              <Input required type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label>
              Підстава звірки
              <Input
                required
                minLength={5}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <Button disabled={busy}>Провести початковий баланс</Button>
          </form>
          <form
            className="grid max-w-2xl gap-3 rounded border p-4"
            onSubmit={(e) => {
              e.preventDefault()
              run(() =>
                postOpeningStock({
                  idempotencyKey: commandKey([
                    'stock',
                    warehouseId,
                    date,
                    note,
                    productId,
                    quantity,
                    price,
                  ]),
                  warehouseId,
                  effectiveAt: date,
                  reason: note,
                  lines: [{ inventoryPartId: productId, quantity, unitPrice: price }],
                })
              )
            }}
          >
            <h2 className="text-xl">Початковий складський залишок</h2>
            <p>
              Для товарів, які ще не мають історії на вибраному складі. Після проведення
              використовуйте інвентаризаційне коригування.
            </p>
            <label>
              Склад
              <select
                required
                className="w-full"
                value={warehouseId}
                onChange={(e) => setWarehouse(e.target.value)}
              >
                <option value="">Виберіть склад</option>
                {data.warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Знайти товар
              <Input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setProduct('')
                }}
              />
            </label>
            <label>
              Товар
              <select
                required
                className="w-full"
                value={productId}
                onChange={(e) => setProduct(e.target.value)}
              >
                <option value="">Виберіть товар</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.partNumber} · {p.brand.name} · {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Кількість
              <Input
                required
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value.replace(',', '.'))}
              />
            </label>
            <label>
              Собівартість одиниці, грн
              <Input
                required
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value.replace(',', '.'))}
              />
            </label>
            <label>
              Дата
              <Input required type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label>
              Підстава
              <Input
                required
                minLength={5}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <Button disabled={busy}>Провести початковий залишок</Button>
          </form>
          <form
            className="grid max-w-2xl gap-3 rounded border p-4"
            onSubmit={(e) => {
              e.preventDefault()
              run(() =>
                (periodAction === 'close' ? closeAccountingPeriod : reopenAccountingPeriod)({
                  idempotencyKey: commandKey([
                    'period',
                    periodAction,
                    through,
                    area,
                    reason,
                    confirmed,
                  ]),
                  through,
                  from: through,
                  area,
                  reason,
                  confirmed,
                })
              )
            }}
          >
            <h2 className="text-xl">Періоди обліку</h2>
            <label>
              Дія з періодом
              <select
                className="min-h-11 w-full rounded border bg-background"
                value={periodAction}
                onChange={(e) => {
                  setPeriodAction(e.target.value)
                  setConfirmed(false)
                }}
              >
                <option value="close">Закрити період</option>
                <option value="reopen">Відкрити період з причиною</option>
              </select>
            </label>
            {periodAction === 'reopen' && (
              <p>
                Історичні вартості не перераховуються. Відкриття дозволяє нові документи з указаною
                датою й записується в аудит.
              </p>
            )}
            <p>
              Склад закрито до:{' '}
              {data.period?.inventoryClosedThrough
                ? new Date(data.period.inventoryClosedThrough).toISOString().slice(0, 10)
                : 'не закрито'}
              ; фінанси:{' '}
              {data.period?.financeClosedThrough
                ? new Date(data.period.financeClosedThrough).toISOString().slice(0, 10)
                : 'не закрито'}
            </p>
            <label>
              {periodAction === 'close' ? 'Закрити включно до' : 'Відкрити починаючи з'}
              <Input
                required
                type="date"
                value={through}
                onChange={(e) => setThrough(e.target.value)}
              />
            </label>
            <label>
              Облік
              <select className="w-full" value={area} onChange={(e) => setArea(e.target.value)}>
                <option value="BOTH">Склад і фінанси</option>
                <option value="INVENTORY">Склад</option>
                <option value="FINANCE">Фінанси</option>
              </select>
            </label>
            <label>
              Підстава
              <Input
                required
                minLength={5}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />{' '}
              Звірку завершено; проведення в закриті дати буде заблоковане
            </label>
            <Button disabled={busy || !confirmed}>
              {periodAction === 'close' ? 'Закрити період' : 'Відкрити період'}
            </Button>
          </form>
          <section className="grid gap-3">
            <h2 className="text-xl">Звірка кількості й резервів</h2>
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                const r = await getLedgerReconciliation()
                setCheck(r.data)
                setError(r.error ?? '')
                setBusy(false)
              }}
            >
              Виконати звірку
            </Button>
            {data?.diagnostic && (
              <p>
                Автоматична звірка: {new Date(data.diagnostic.checkedAt).toLocaleString('uk-UA')} ·
                Розбіжностей: {data.diagnostic.count}. Автоматичне виправлення не виконується.
              </p>
            )}
            {check && (
              <p>
                {check.length
                  ? `Розбіжностей: ${check.length}`
                  : 'Склад, резерви, каси й розрахунки відповідають документам'}
              </p>
            )}
            {check?.map((r) => (
              <div key={r.kind + ':' + r.id} className="rounded border p-3 text-sm break-words">
                <strong>{r.kind}</strong>
                <p>
                  Очікується: {r.expected}; фактично: {r.actual}
                </p>
                <p className="text-xs">Документ / запис: {r.id}</p>
              </div>
            ))}
          </section>
          <section className="grid gap-3">
            <h2 className="text-xl">Журнал дій</h2>
            {data.audit.map((r) => (
              <details key={r.id} className="min-w-0 rounded border p-3">
                <summary className="break-words">
                  {new Date(r.createdAt).toISOString().slice(0, 19).replace('T', ' ')} UTC ·{' '}
                  {r.action}
                </summary>
                <p className="break-all text-sm">Користувач: {r.createdById}</p>
                <pre className="max-h-64 overflow-auto text-xs">
                  {JSON.stringify(r.payload, null, 2)}
                </pre>
              </details>
            ))}
            <div className="flex gap-3">
              <Button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                Назад
              </Button>
              <span>{page}</span>
              <Button disabled={page * 25 >= data.total} onClick={() => setPage((p) => p + 1)}>
                Далі
              </Button>
            </div>
          </section>
        </>
      )}
    </section>
  )
}
