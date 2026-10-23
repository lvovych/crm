'use client'
import { cloneElement, useId, type ReactElement, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { FulfillmentPanel } from './FulfillmentPanel'
import { PurchasesPanel } from './PurchasesPanel'
import { SettlementReversal, StatementDownload } from './SettlementTools'
import { StockActions } from './StockActions'
import { ReceiptAllocation } from './ReceiptAllocation'
import { FinancialReportPanel } from './FinancialReportPanel'
import { AdministrationPanel } from './AdministrationPanel'
import { StockOverview } from './StockOverview'
import { DirectoryManager } from './DirectoryManager'
import { ImportPanel } from './ImportPanel'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  getLedgerDirectory,
  getLedgerDocument,
  listLedgerDocuments,
  listLedgerStock,
  searchLedgerProducts,
  saveReceipt,
  postReceipt,
  saveSupplier,
  saveWarehouse,
  saveCashAccount,
  getSupplierFinances,
  postSupplierPayment,
  allocateSupplierPayment,
} from '../Actions/ledgerActions'
import type { ActionResult } from '@/lib/with-auth'
import { calculateLine, lineSchema, type LineInput } from '../Lib/amounts'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type Data<F extends (...args: never[]) => Promise<ActionResult<unknown>>> = NonNullable<
  Awaited<ReturnType<F>>['data']
>
type Product = Data<typeof searchLedgerProducts>[number]
type Line = LineInput & { name: string; brand: string; article: string | null }
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date())
const field = 'min-h-11 w-full min-w-0 rounded-md border bg-background px-3 py-2 text-base'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId()
  return (
    <div className="grid min-w-0 gap-1 text-sm">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children as ReactElement<{ id?: string }>, { id })}
    </div>
  )
}
function RecordCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 gap-3 rounded-lg border p-3 md:grid-cols-4 md:items-center">
      {children}
    </div>
  )
}
export function LedgerWorkspace() {
  const [tab, setTab] = useState('receipts'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0)
  const [directory, setDirectory] = useState<Data<typeof getLedgerDirectory>>()
  const [documents, setDocuments] = useState<Data<typeof listLedgerDocuments>>()
  const [stock, setStock] = useState<Data<typeof listLedgerStock>>()
  const [finances, setFinances] = useState<Data<typeof getSupplierFinances>>()
  const [party, setParty] = useState(''),
    [page, setPage] = useState(1),
    [search, setSearch] = useState('')
  useEffect(() => {
    const view = new URLSearchParams(window.location.search).get('view')
    if (
      view &&
      [
        'receipts',
        'overview',
        'stock',
        'demands',
        'purchases',
        'import',
        'report',
        'finances',
        'directories',
        'administration',
      ].includes(view)
    )
      setTab(view)
  }, [])
  const keys = useRef(new Map<string, string>())
  const execute = async <T,>(action: (v: unknown) => Promise<ActionResult<T>>, payload: object) => {
    const fingerprint = JSON.stringify(payload) + action.name
    const key = keys.current.get(fingerprint) ?? crypto.randomUUID()
    keys.current.set(fingerprint, key)
    setBusy(true)
    setError('')
    try {
      const response = await action({ ...payload, idempotencyKey: key })
      if (!response.success || !response.data)
        throw new Error(response.error ?? 'Не вдалося зберегти')
      keys.current.delete(fingerprint)
      setRevision((v) => v + 1)
      return response.data
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося зберегти')
      return undefined
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    let cancelled = false
    setError('')
    const load = async () => {
      const results =
        tab === 'finances'
          ? [await getSupplierFinances(party || undefined)]
          : tab === 'stock'
            ? [await listLedgerStock(page)]
            : [await getLedgerDirectory(), await listLedgerDocuments({ page, search })]
      if (cancelled) return
      const failure = results.find((r) => !r.success)
      if (failure) {
        setError(failure.error ?? 'Не вдалося завантажити')
        return
      }
      if (tab === 'finances') setFinances(results[0].data as Data<typeof getSupplierFinances>)
      else if (tab === 'stock') setStock(results[0].data as Data<typeof listLedgerStock>)
      else {
        setDirectory(results[0].data as Data<typeof getLedgerDirectory>)
        setDocuments(results[1].data as Data<typeof listLedgerDocuments>)
      }
    }
    load().catch(() => !cancelled && setError('Не вдалося завантажити'))
    return () => {
      cancelled = true
    }
  }, [tab, page, search, party, revision])
  const [draft, setDraft] = useState<{ id?: string; version?: number; status: string }>({
    status: 'DRAFT',
  })
  const [supplierId, setSupplierId] = useState(''),
    [warehouseId, setWarehouseId] = useState(''),
    [date, setDate] = useState(today),
    [dueDate, setDueDate] = useState(today),
    [external, setExternal] = useState(''),
    [note, setNote] = useState('')
  const [savedPayload, setSavedPayload] = useState(''),
    [detailIndex, setDetailIndex] = useState<number | null>(null)
  const [lines, setLines] = useState<Line[]>([]),
    [query, setQuery] = useState(''),
    [products, setProducts] = useState<Product[]>([]),
    [selected, setSelected] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const editing = draft.status === 'DRAFT'
  const payloadText = JSON.stringify({
    supplierId,
    warehouseId,
    date,
    dueDate,
    external,
    note,
    lines,
  })
  const dirty = editing && payloadText !== savedPayload && (lines.length > 0 || external.length > 0)
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const leave = () => !dirty || window.confirm('Є незбережені зміни. Вийти без збереження?')

  useEffect(() => {
    let active = true
    const timer = setTimeout(() => {
      if (query.trim())
        searchLedgerProducts(query).then((r) => {
          if (active) {
            setProducts(r.data ?? [])
            setSelected(0)
          }
        })
      else setProducts([])
    }, 180)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [query])
  const addProduct = (p: Product) => {
    setLines((l) => [
      ...l,
      {
        inventoryPartId: p.id,
        name: p.name,
        brand: p.brand.name,
        article: p.partNumber,
        quantity: '1',
        unitPrice: '0',
        discountType: 'NONE',
        discountValue: '0',
        taxMode: 'NONE',
        taxRate: '0',
      },
    ])
    setQuery('')
    setProducts([])
    searchRef.current?.focus()
  }
  const loadDocument = async (id: string) => {
    const r = await getLedgerDocument(id)
    if (!r.data) {
      setError(r.error ?? 'Не знайдено')
      return
    }
    const d = r.data
    setDraft({ id: d.id, version: d.version, status: d.status })
    setSupplierId(d.supplierId)
    setWarehouseId(d.targetWarehouseId)
    setDate(d.effectiveAt.slice(0, 10))
    setDueDate(d.dueDate?.slice(0, 10) ?? today())
    setExternal(d.externalNumber ?? '')
    setNote(d.note ?? '')
    setLines(
      d.inventoryDocumentLine_document.map((l) => ({
        ...l,
        purchaseOrderLineId: l.purchaseOrderLineId ?? undefined,
        name: l.snapshotName,
        brand: l.snapshotBrand,
        article: l.snapshotArticle,
      }))
    )
    setSavedPayload(
      JSON.stringify({
        supplierId: d.supplierId,
        warehouseId: d.targetWarehouseId,
        date: d.effectiveAt.slice(0, 10),
        dueDate: d.dueDate?.slice(0, 10) ?? today(),
        external: d.externalNumber ?? '',
        note: d.note ?? '',
        lines: d.inventoryDocumentLine_document.map((l) => ({
          ...l,
          purchaseOrderLineId: l.purchaseOrderLineId ?? undefined,
          name: l.snapshotName,
          brand: l.snapshotBrand,
          article: l.snapshotArticle,
        })),
      })
    )
    setTab('editor')
  }
  const newReceipt = () => {
    if (!leave()) return
    setSavedPayload('')
    setDraft({ status: 'DRAFT' })
    setLines([])
    setExternal('')
    setNote('')
    setDate(today())
    setDueDate(today())
    setTab('editor')
  }
  const save = async () => {
    const result = await execute(saveReceipt, {
      documentId: draft.id,
      expectedVersion: draft.version,
      supplierId,
      warehouseId,
      effectiveAt: date,
      externalNumber: external,
      externalDate: date,
      dueDate,
      note,
      lines: lines.map(({ name, brand, article, ...line }) => line),
    })
    if (result) {
      setSavedPayload(payloadText)
      setDraft({ id: result.id, version: result.version, status: result.status })
      toast.success('Чернетку збережено')
    }
  }
  const [directoryName, setDirectoryName] = useState(''),
    [directoryKind, setDirectoryKind] = useState('supplier'),
    [code, setCode] = useState(''),
    [supplierKind, setSupplierKind] = useState('GOODS'),
    [terms, setTerms] = useState('0'),
    [supplierPhone, setSupplierPhone] = useState(''),
    [supplierEmail, setSupplierEmail] = useState(''),
    [accountKind, setAccountKind] = useState('BANK')
  const [accountId, setAccountId] = useState(''),
    [amount, setAmount] = useState(''),
    [paymentDate, setPaymentDate] = useState(today),
    [direction, setDirection] = useState('OUT'),
    [debit, setDebit] = useState(''),
    [credit, setCredit] = useState(''),
    [allocateAmount, setAllocateAmount] = useState('')
  return (
    <div className="mx-auto grid max-w-7xl min-w-0 gap-5 pb-20 [&_button]:min-h-11 [&_input]:min-h-11">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Склад і постачальники</h1>
        <Link
          href="/inventory"
          className="underline"
          onClick={(e) => {
            if (!leave()) e.preventDefault()
          }}
        >
          Каталог товарів
        </Link>
      </div>
      <nav aria-label="Складський облік" className="flex flex-wrap gap-2">
        {[
          ['receipts', 'Надходження'],
          ['overview', 'Залишки'],
          ['stock', 'Партії та операції'],
          ['demands', 'Потреби нарядів'],
          ['purchases', 'Закупівлі'],
          ['import', 'Імпорт'],
          ['report', 'Звіти на дату'],
          ['finances', 'Розрахунки'],
          ['directories', 'Довідники'],
          ...(directory?.isAdmin ? [['administration', 'Адміністрування']] : []),
        ].map(([key, label]) => (
          <Button
            key={key}
            variant={tab === key ? 'default' : 'outline'}
            onClick={() => {
              if (!leave()) return
              setTab(key)
              const url = new URL(window.location.href)
              url.searchParams.set('view', key)
              window.history.replaceState(null, '', url)
              setPage(1)
            }}
          >
            {label}
          </Button>
        ))}
      </nav>
      <p className="text-sm text-muted-foreground">
        Окремий облік нових операцій. Історичні залишки та оплати сюди автоматично не перенесені.
      </p>
      {error && (
        <div role="alert" className="rounded border border-destructive p-3">
          {error}
          <Button variant="ghost" onClick={() => setRevision((v) => v + 1)}>
            Повторити завантаження
          </Button>
        </div>
      )}
      {tab === 'receipts' && (
        <>
          <div className="flex flex-wrap gap-3">
            <Input
              className="max-w-sm"
              aria-label="Пошук накладної"
              placeholder="Номер накладної"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
            />
            <Button onClick={newReceipt}>Нове надходження</Button>
          </div>
          {documents?.rows.map((d) => (
            <RecordCard key={d.id}>
              <button
                className="min-h-11 break-all text-left underline"
                onClick={() => loadDocument(d.id)}
              >
                {d.externalNumber || d.number}
              </button>
              <span>
                {d.supplier?.name}
                <br />
                {d.targetWarehouse?.name}
              </span>
              <span>
                {d.status === 'DRAFT'
                  ? 'Чернетка'
                  : d.status === 'REVERSED'
                    ? 'Сторновано'
                    : d.status === 'CANCELLED'
                      ? 'Скасовано'
                      : 'Проведено'}
              </span>
              <strong className="md:text-right">{d.totalAmount} грн</strong>
            </RecordCard>
          ))}
          {documents?.total === 0 && <p>Надходжень ще немає. Створіть першу чернетку.</p>}
        </>
      )}
      {tab === 'editor' && (
        <section className="grid min-w-0 gap-4">
          <h2 className="text-xl">
            {editing
              ? 'Надходження — чернетка'
              : draft.status === 'REVERSED'
                ? 'Надходження — сторновано'
                : 'Надходження — проведено'}
          </h2>
          {dirty && <p className="text-sm">Збережіть зміни перед проведенням.</p>}
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Постачальник">
              <select
                className={field}
                disabled={!editing}
                value={supplierId}
                onChange={(e) => {
                  setSupplierId(e.target.value)
                  const days =
                    directory?.suppliers.find((s) => s.id === e.target.value)?.paymentTermsDays ?? 0
                  const d = new Date(date)
                  d.setUTCDate(d.getUTCDate() + days)
                  setDueDate(d.toISOString().slice(0, 10))
                }}
              >
                <option value="">Виберіть</option>
                {directory?.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Склад">
              <select
                className={field}
                disabled={!editing}
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
              >
                <option value="">Виберіть</option>
                {directory?.warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Номер накладної постачальника">
              <Input
                disabled={!editing}
                value={external}
                onChange={(e) => setExternal(e.target.value)}
              />
            </Field>
            <Field label="Дата надходження / накладної">
              <Input
                type="date"
                disabled={!editing}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field label="Оплатити до">
              <Input
                type="date"
                disabled={!editing}
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </Field>
            <Field label="Коментар">
              <Input disabled={!editing} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
          {draft.id && draft.status === 'POSTED' && (
            <SettlementReversal
              paymentId={null}
              receiptId={draft.id}
              allocations={[]}
              onSaved={() => {
                void loadDocument(draft.id!)
                setRevision((v) => v + 1)
              }}
            />
          )}
          {editing && draft.id && !dirty && (
            <ReceiptAllocation
              documentId={draft.id}
              onSaved={() => {
                void loadDocument(draft.id!)
              }}
            />
          )}
          {editing && (
            <div className="relative">
              <Input
                ref={searchRef}
                role="combobox"
                aria-label="Додати товар"
                aria-expanded={products.length > 0}
                aria-controls="ledger-products"
                aria-activedescendant={products[selected] ? `product-${selected}` : undefined}
                placeholder="Назва або артикул — стрілки й Enter для додавання"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setSelected((i) => Math.min(i + 1, products.length - 1))
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setSelected((i) => Math.max(i - 1, 0))
                  }
                  if (e.key === 'Enter' && products[selected]) {
                    e.preventDefault()
                    addProduct(products[selected])
                  }
                  if (e.key === 'Escape') setProducts([])
                }}
              />
              {products.length > 0 && (
                <ul
                  id="ledger-products"
                  role="listbox"
                  className="absolute z-20 max-h-72 w-full overflow-y-auto rounded border bg-background shadow-lg"
                >
                  {products.map((p, i) => (
                    <li key={p.id} id={`product-${i}`} role="option" aria-selected={i === selected}>
                      <button
                        className={`min-h-11 w-full p-3 text-left ${i === selected ? 'bg-accent' : ''}`}
                        onClick={() => addProduct(p)}
                      >
                        {p.partNumber} · {p.brand.name} · {p.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="grid gap-3">
            {lines.map((line, index) => (
              <div key={index} className="grid min-w-0 gap-3 rounded-lg border p-3 md:grid-cols-6">
                <div className="min-w-0 break-words md:col-span-2">
                  <strong>{line.name}</strong>
                  <div className="text-sm text-muted-foreground">
                    {line.article} · {line.brand}
                  </div>
                </div>
                {(['quantity', 'unitPrice', 'discountValue'] as const).map((key, i) => (
                  <Field
                    key={key}
                    label={['Кількість', 'Закупівельна ціна', 'Знижка, грн на рядок'][i]}
                  >
                    <Input
                      inputMode="decimal"
                      disabled={!editing}
                      value={line[key]}
                      onChange={(e) =>
                        setLines((rows) =>
                          rows.map((l, j) =>
                            j === index
                              ? {
                                  ...l,
                                  [key]: e.target.value,
                                  ...(key === 'discountValue'
                                    ? { discountType: 'AMOUNT' as const }
                                    : {}),
                                }
                              : l
                          )
                        )
                      }
                    />
                  </Field>
                ))}
                <Button
                  variant="outline"
                  disabled={!editing}
                  aria-label={`Видалити ${line.name}`}
                  onClick={() => setLines((l) => l.filter((_, i) => i !== index))}
                >
                  Видалити
                </Button>
                <div className="flex flex-wrap items-center justify-between gap-2 md:col-span-6">
                  <strong>
                    Сума: {(() => {
                      try {
                        return calculateLine(lineSchema.parse(line)).totalAmount.toFixed(2) + ' грн'
                      } catch {
                        return '—'
                      }
                    })()}
                  </strong>
                  <Button variant="outline" onClick={() => setDetailIndex(index)}>
                    Деталі рядка
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <Dialog
            open={detailIndex !== null}
            onOpenChange={(open) => {
              if (!open) setDetailIndex(null)
            }}
          >
            <DialogContent className="max-h-[90dvh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Деталі позиції</DialogTitle>
              </DialogHeader>
              {detailIndex !== null && lines[detailIndex] && (
                <div className="grid gap-4">
                  {' '}
                  <Field label="Податок">
                    <select
                      className={field}
                      disabled={!editing}
                      value={lines[detailIndex].taxMode}
                      onChange={(e) =>
                        setLines((rows) =>
                          rows.map((l, j) =>
                            j === detailIndex
                              ? {
                                  ...l,
                                  taxMode: e.target.value as Line['taxMode'],
                                  taxRate: e.target.value === 'NONE' ? '0' : l.taxRate,
                                }
                              : l
                          )
                        )
                      }
                    >
                      <option value="NONE">Без податку</option>
                      <option value="INCLUSIVE">Включений у ціну</option>
                      <option value="EXCLUSIVE">Додати до ціни</option>
                    </select>
                  </Field>
                  <Field label="Ставка, %">
                    <Input
                      inputMode="decimal"
                      disabled={!editing || lines[detailIndex].taxMode === 'NONE'}
                      value={lines[detailIndex].taxRate}
                      onChange={(e) =>
                        setLines((rows) =>
                          rows.map((l, j) =>
                            j === detailIndex ? { ...l, taxRate: e.target.value } : l
                          )
                        )
                      }
                    />
                  </Field>
                </div>
              )}
            </DialogContent>
          </Dialog>
          {draft.id && draft.status === 'POSTED' && (
            <SettlementReversal
              paymentId={null}
              receiptId={draft.id}
              allocations={[]}
              onSaved={() => {
                void loadDocument(draft.id!)
                setRevision((v) => v + 1)
              }}
            />
          )}
          {editing && draft.id && !dirty && (
            <ReceiptAllocation
              documentId={draft.id}
              onSaved={() => {
                void loadDocument(draft.id!)
              }}
            />
          )}
          {editing && (
            <div className="flex flex-wrap gap-3">
              <Button disabled={busy} onClick={save}>
                Зберегти чернетку
              </Button>
              {draft.id && (
                <Button
                  variant="outline"
                  disabled={busy || dirty}
                  onClick={async () => {
                    if (
                      !window.confirm(
                        'Провести збережену чернетку? Залишок і борг постачальнику збільшаться.'
                      )
                    )
                      return
                    const result = await execute(postReceipt, {
                      documentId: draft.id,
                      expectedVersion: draft.version,
                    })
                    if (result) {
                      await loadDocument(result.id)
                      toast.success('Надходження проведено')
                    }
                  }}
                >
                  Провести збережену чернетку
                </Button>
              )}
            </div>
          )}
        </section>
      )}
      {tab === 'purchases' && <PurchasesPanel />}
      {tab === 'import' && <ImportPanel />}
      {tab === 'demands' && <FulfillmentPanel />}
      {tab === 'report' && <FinancialReportPanel />}
      {tab === 'administration' && directory?.isAdmin && <AdministrationPanel />}
      {tab === 'overview' && <StockOverview />}
      {tab === 'stock' && (
        <>
          {stock?.rows.map((r) => (
            <RecordCard key={r.id}>
              <div className="break-words">
                <strong>{r.name}</strong>
                <p>
                  {r.article} · {r.brand}
                </p>
              </div>
              <span>{r.warehouse}</span>
              <span>
                На складі: {r.onHand}
                <br />
                Резерв: {r.reserved}
              </span>
              <strong>Доступно: {r.available}</strong>
              <div className="md:col-span-4">
                <StockActions balance={r} onSaved={() => setRevision((v) => v + 1)} />
              </div>
            </RecordCard>
          ))}
          {stock?.total === 0 && <p>Партій ще немає. Проведіть надходження.</p>}
        </>
      )}
      {tab === 'directories' && (
        <section className="grid max-w-xl gap-3">
          <h2 className="text-xl">Створити запис довідника</h2>
          <Field label="Тип">
            <select
              className={field}
              value={directoryKind}
              onChange={(e) => setDirectoryKind(e.target.value)}
            >
              <option value="supplier">Постачальник</option>
              <option value="warehouse">Склад</option>
              <option value="account">Каса / рахунок</option>
            </select>
          </Field>
          <Field label="Назва">
            <Input value={directoryName} onChange={(e) => setDirectoryName(e.target.value)} />
          </Field>
          {directoryKind === 'supplier' && (
            <>
              <Field label="Постачає">
                <select
                  className={field}
                  value={supplierKind}
                  onChange={(e) => setSupplierKind(e.target.value)}
                >
                  <option value="GOODS">Товари</option>
                  <option value="SERVICES">Послуги</option>
                  <option value="BOTH">Товари та послуги</option>
                </select>
              </Field>
              <Field label="Відстрочка оплати, днів">
                <Input
                  type="number"
                  min="0"
                  max="365"
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                />
              </Field>
              <Field label="Телефон постачальника">
                <Input value={supplierPhone} onChange={(e) => setSupplierPhone(e.target.value)} />
              </Field>
              <Field label="Електронна пошта постачальника">
                <Input
                  type="email"
                  value={supplierEmail}
                  onChange={(e) => setSupplierEmail(e.target.value)}
                />
              </Field>
            </>
          )}
          {directoryKind === 'account' && (
            <Field label="Вид рахунку">
              <select
                className={field}
                value={accountKind}
                onChange={(e) => setAccountKind(e.target.value)}
              >
                <option value="BANK">Банківський рахунок</option>
                <option value="CASH">Готівкова каса</option>
                <option value="CARD_CLEARING">Розрахунки за картками</option>
              </select>
            </Field>
          )}
          {directoryKind === 'warehouse' && (
            <Field label="Код складу">
              <Input value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
          )}
          <Button
            disabled={busy || !directory?.isAdmin}
            onClick={async () => {
              const result = await execute(
                directoryKind === 'supplier'
                  ? saveSupplier
                  : directoryKind === 'warehouse'
                    ? saveWarehouse
                    : saveCashAccount,
                {
                  name: directoryName,
                  ...(directoryKind === 'warehouse'
                    ? { code }
                    : directoryKind === 'supplier'
                      ? {
                          kind: supplierKind,
                          paymentTermsDays: Number(terms),
                          phone: supplierPhone,
                          email: supplierEmail,
                        }
                      : { kind: accountKind }),
                }
              )
              if (result) {
                setDirectoryName('')
                setCode('')
                toast.success('Створено')
              }
            }}
          >
            Створити
          </Button>
          <p className="text-sm text-muted-foreground">Довідники створює адміністратор.</p>
          {directory?.isAdmin && (
            <DirectoryManager revision={revision} onSaved={() => setRevision((v) => v + 1)} />
          )}
        </section>
      )}
      {tab === 'finances' && finances && (
        <section className="grid gap-4">
          <Field label="Постачальник">
            <select
              className={field}
              value={party || finances.selectedPartyId || ''}
              onChange={(e) => setParty(e.target.value)}
            >
              {finances.parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayNameSnapshot}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex flex-wrap gap-6">
            <strong>Борг: {finances.debt} грн</strong>
            <strong>Аванс: {finances.advance} грн</strong>
          </div>
          {finances.selectedPartyId && <StatementDownload partyId={finances.selectedPartyId} />}
          {finances.rows.map((r) => (
            <RecordCard key={r.id}>
              <span>
                {r.label} · {r.date}
              </span>
              <span>
                {r.polarity === 'DEBIT' ? 'Нараховано' : 'Кредит / оплата'}: {r.amount}
              </span>
              <span>Рознесено: {r.allocated}</span>
              <strong>Залишок: {r.remaining}</strong>
              <div className="md:col-span-4">
                <SettlementReversal
                  paymentId={r.paymentId}
                  allocations={r.polarity === 'DEBIT' ? r.allocations : []}
                  onSaved={() => setRevision((v) => v + 1)}
                />
              </div>
            </RecordCard>
          ))}
          <fieldset disabled={busy} className="grid gap-3 rounded-lg border p-4 md:grid-cols-3">
            <legend>Зареєструвати оплату</legend>
            <Field label="Каса / рахунок">
              <select
                className={field}
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                <option value="">Виберіть</option>
                {finances.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Напрям">
              <select
                className={field}
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
              >
                <option value="OUT">Оплата постачальнику</option>
                <option value="IN">Повернення від постачальника</option>
              </select>
            </Field>
            <Field label="Сума, грн">
              <Input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label="Дата">
              <Input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
              />
            </Field>
            <Button
              onClick={async () => {
                if (!window.confirm('Записати факт оплати? Банківський переказ не виконується.'))
                  return
                const r = await execute(postSupplierPayment, {
                  partyId: party || finances.selectedPartyId,
                  accountId,
                  direction,
                  amount,
                  effectiveAt: paymentDate,
                  method: 'manual',
                })
                if (r) {
                  setAmount('')
                  toast.success('Оплату зареєстровано')
                }
              }}
            >
              Зареєструвати оплату
            </Button>
          </fieldset>
          <fieldset disabled={busy} className="grid gap-3 rounded-lg border p-4 md:grid-cols-3">
            <legend>Рознести оплату</legend>
            <Field label="Нарахування">
              <select className={field} value={debit} onChange={(e) => setDebit(e.target.value)}>
                <option value="">Виберіть</option>
                {finances.rows
                  .filter((r) => r.polarity === 'DEBIT' && r.remaining !== '0.00')
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label} · {r.remaining} грн
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Оплата / аванс">
              <select className={field} value={credit} onChange={(e) => setCredit(e.target.value)}>
                <option value="">Виберіть</option>
                {finances.rows
                  .filter((r) => r.polarity === 'CREDIT' && r.remaining !== '0.00')
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.date} · {r.remaining} грн
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Сума рознесення">
              <Input
                inputMode="decimal"
                value={allocateAmount}
                onChange={(e) => setAllocateAmount(e.target.value)}
              />
            </Field>
            <Button
              onClick={async () => {
                const r = await execute(allocateSupplierPayment, {
                  debitEntryId: debit,
                  creditEntryId: credit,
                  amount: allocateAmount,
                  effectiveAt: today(),
                })
                if (r) {
                  setAllocateAmount('')
                  toast.success('Оплату рознесено')
                }
              }}
            >
              Рознести
            </Button>
          </fieldset>
        </section>
      )}
      {(tab === 'stock' || tab === 'receipts') && (
        <div className="flex items-center gap-3">
          <Button variant="outline" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            Назад
          </Button>
          <span>Сторінка {page}</span>
          <Button
            variant="outline"
            disabled={page * 25 >= ((tab === 'stock' ? stock?.total : documents?.total) ?? 0)}
            onClick={() => setPage((p) => p + 1)}
          >
            Далі
          </Button>
        </div>
      )}
    </div>
  )
}
