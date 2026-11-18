import { getOperationText } from '@/i18n/operation-text.server'
import { ReturnSupplierFilter } from '@/features/receipts/ReturnSupplierFilter'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { DocumentHeader } from '@/components/operations/document-ui'
import { ReturnList } from '@/features/receipts/ReturnList'
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const ot = await getOperationText()

  const q = await searchParams
  return (
    <div className="space-y-6">
      <DocumentHeader
        title={ot('Повернення постачальникам')}
        back={{ href: '/documents', label: ot('Журнал документів') }}
        actions={
          <Button asChild>
            <Link href="/suppliers">{ot('Обрати постачальника для повернення')}</Link>
          </Button>
        }
      />
      <form className="ops-panel flex flex-wrap items-end gap-4 [&_label]:grid [&_label]:gap-2 [&_input]:rounded-md [&_input]:border [&_input]:bg-background [&_input]:p-3">
        <ReturnSupplierFilter key={q.supplier || ''} initialId={q.supplier} />
        <label>
          {ot('Номер або постачальник')}
          <input name="q" maxLength={120} defaultValue={q.q} />
        </label>
        <label>
          {ot('Статус')}
          <select
            name="status"
            defaultValue={q.status || ''}
            className="rounded-md border bg-background p-3"
          >
            <option value="">{ot('Усі')}</option>
            <option value="draft">{ot('Чернетка')}</option>
            <option value="posted">{ot('Проведено')}</option>
          </select>
        </label>
        <label>
          {ot('Від')}
          <input type="date" name="from" defaultValue={q.from} />
        </label>
        <label>
          {ot('До')}
          <input type="date" name="to" defaultValue={q.to} />
        </label>
        <Button>{ot('Показати')}</Button>
        <Button asChild variant="outline">
          <Link href="/supplier-returns">{ot('Скинути')}</Link>
        </Button>
      </form>
      <ReturnList filters={q} />
    </div>
  )
}
