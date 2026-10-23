'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { listManagedDirectories, updateLedgerDirectory } from '../Actions/ledgerActions'
type Data = NonNullable<Awaited<ReturnType<typeof listManagedDirectories>>['data']>
type Edit = {
  kind: 'supplier' | 'warehouse' | 'account'
  id: string
  expectedVersion: number
  name: string
  archived: boolean
  code: string
  reservable: boolean
  isDefault: boolean
  supplierKind: string
  accountKind: string
  phone: string
  email: string
  taxId: string
  paymentTermsDays: number
}
export function DirectoryManager({ revision, onSaved }: { revision: number; onSaved: () => void }) {
  const [data, setData] = useState<Data>(),
    [edit, setEdit] = useState<Edit>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [archived, setArchived] = useState(false),
    [search, setSearch] = useState('')
  useEffect(() => {
    let live = true
    listManagedDirectories().then((r) => {
      if (live) {
        setData(r.data)
        setError(r.error ?? '')
      }
    })
    return () => {
      live = false
    }
  }, [revision])
  const rows = [
    ...(data?.suppliers ?? []).map((r) => ({ ...r, type: 'supplier' as const })),
    ...(data?.warehouses ?? []).map((r) => ({ ...r, type: 'warehouse' as const })),
    ...(data?.accounts ?? []).map((r) => ({ ...r, type: 'account' as const })),
  ].filter(
    (r) =>
      (archived || !r.archivedAt) && r.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())
  )
  const patch = (p: Partial<Edit>) => setEdit((e) => e && { ...e, ...p })
  return (
    <section className="grid gap-3 [&_button]:min-h-11 [&_input]:min-h-11 [&_select]:min-h-11">
      <h2 className="text-xl">Редагування довідників</h2>
      <Input
        aria-label="Пошук у довідниках"
        placeholder="Пошук за назвою"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <label>
        <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />{' '}
        Показувати архівні
      </label>
      {error && <p role="alert">{error}</p>}
      {rows.map((r) => (
        <div
          key={r.type + r.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded border p-3"
        >
          <span>
            {r.name} ·{' '}
            {r.type === 'supplier' ? 'Постачальник' : r.type === 'warehouse' ? 'Склад' : 'Рахунок'}
            {r.archivedAt ? ' · Архівний' : ''}
          </span>
          <Button
            variant="outline"
            onClick={() => {
              setError('')
              setEdit({
                kind: r.type,
                id: r.id,
                expectedVersion: r.version,
                name: r.name,
                archived: !!r.archivedAt,
                code: 'code' in r ? r.code : '',
                reservable: 'reservable' in r ? r.reservable : true,
                isDefault: 'isDefault' in r ? r.isDefault : false,
                supplierKind: r.type === 'supplier' ? r.kind : 'GOODS',
                accountKind: r.type === 'account' ? r.kind : 'BANK',
                phone: r.type === 'supplier' ? (r.phone ?? '') : '',
                email: r.type === 'supplier' ? (r.email ?? '') : '',
                taxId: r.type === 'supplier' ? (r.taxId ?? '') : '',
                paymentTermsDays: r.type === 'supplier' ? r.paymentTermsDays : 0,
              })
            }}
          >
            Редагувати
          </Button>
        </div>
      ))}
      <Dialog
        open={!!edit}
        onOpenChange={(open) => {
          if (!open && !busy) setEdit(undefined)
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Редагувати запис</DialogTitle>
          </DialogHeader>
          {edit && (
            <form
              className="grid gap-3"
              onSubmit={async (e) => {
                e.preventDefault()
                setBusy(true)
                const r = await updateLedgerDirectory(edit.kind, {
                  ...edit,
                  kind: edit.kind === 'supplier' ? edit.supplierKind : edit.accountKind,
                  idempotencyKey: crypto.randomUUID(),
                })
                setBusy(false)
                if (r.success) {
                  setEdit(undefined)
                  onSaved()
                } else setError(r.error ?? 'Помилка')
              }}
            >
              <label>
                Назва
                <Input
                  required
                  value={edit.name}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </label>
              {edit.kind === 'supplier' && (
                <>
                  <label>
                    Постачає
                    <select
                      className="w-full rounded border bg-background p-2"
                      value={edit.supplierKind}
                      onChange={(e) => patch({ supplierKind: e.target.value })}
                    >
                      <option value="GOODS">Товари</option>
                      <option value="SERVICES">Послуги</option>
                      <option value="BOTH">Товари та послуги</option>
                    </select>
                  </label>
                  <label>
                    Телефон
                    <Input value={edit.phone} onChange={(e) => patch({ phone: e.target.value })} />
                  </label>
                  <label>
                    Email
                    <Input
                      type="email"
                      value={edit.email}
                      onChange={(e) => patch({ email: e.target.value })}
                    />
                  </label>
                  <label>
                    Податковий номер
                    <Input value={edit.taxId} onChange={(e) => patch({ taxId: e.target.value })} />
                  </label>
                  <label>
                    Відстрочка оплати, днів
                    <Input
                      type="number"
                      min="0"
                      max="365"
                      value={edit.paymentTermsDays}
                      onChange={(e) => patch({ paymentTermsDays: Number(e.target.value) })}
                    />
                  </label>
                </>
              )}
              {edit.kind === 'warehouse' && (
                <>
                  <label>
                    Код
                    <Input
                      required
                      value={edit.code}
                      onChange={(e) => patch({ code: e.target.value })}
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={edit.reservable}
                      onChange={(e) => patch({ reservable: e.target.checked })}
                    />{' '}
                    Дозволяти резервування
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={edit.isDefault}
                      onChange={(e) => patch({ isDefault: e.target.checked })}
                    />{' '}
                    Склад за замовчуванням
                  </label>
                </>
              )}
              {edit.kind === 'account' && (
                <label>
                  Вид
                  <select
                    className="w-full rounded border bg-background p-2"
                    value={edit.accountKind}
                    onChange={(e) => patch({ accountKind: e.target.value })}
                  >
                    <option value="BANK">Банківський рахунок</option>
                    <option value="CASH">Готівкова каса</option>
                    <option value="CARD_CLEARING">Розрахунки за картками</option>
                  </select>
                </label>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={edit.archived}
                  onChange={(e) => patch({ archived: e.target.checked })}
                />{' '}
                Архівний запис
              </label>
              <p className="text-sm text-muted-foreground">
                Архівування зберігає історію. Зніміть позначку, щоб відновити запис.
              </p>
              {error && <p role="alert">{error}</p>}
              <Button disabled={busy} type="submit">
                Зберегти зміни
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}
