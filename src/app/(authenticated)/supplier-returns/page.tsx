import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { DocumentHeader } from '@/components/operations/document-ui'
import { listSupplierReturns } from '@/features/receipts/return-actions'
import { ReturnList } from '@/features/receipts/ReturnList'
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const q = await searchParams
  const options = await listSupplierReturns()
  return (
    <div className="space-y-6">
      <DocumentHeader
        title="Повернення постачальникам"
        back={{ href: '/documents', label: 'Журнал документів' }}
        actions={
          <Button asChild>
            <Link href="/suppliers">Обрати постачальника для повернення</Link>
          </Button>
        }
      />
      <form className="ops-panel flex flex-wrap items-end gap-4 [&_label]:grid [&_label]:gap-2 [&_input]:rounded-md [&_input]:border [&_input]:bg-background [&_input]:p-3">
        <label>
          Постачальник
          <select
            name="supplier"
            defaultValue={q.supplier || ''}
            className="rounded-md border bg-background p-3"
          >
            <option value="">Усі</option>
            {options.data?.suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Номер або постачальник
          <input name="q" defaultValue={q.q} />
        </label>
        <label>
          Статус
          <select
            name="status"
            defaultValue={q.status || ''}
            className="rounded-md border bg-background p-3"
          >
            <option value="">Усі</option>
            <option value="draft">Чернетка</option>
            <option value="posted">Проведено</option>
          </select>
        </label>
        <label>
          Від
          <input type="date" name="from" defaultValue={q.from} />
        </label>
        <label>
          До
          <input type="date" name="to" defaultValue={q.to} />
        </label>
        <Button>Показати</Button>
        <Button asChild variant="outline">
          <Link href="/supplier-returns">Скинути</Link>
        </Button>
      </form>
      <ReturnList filters={q} />
    </div>
  )
}
