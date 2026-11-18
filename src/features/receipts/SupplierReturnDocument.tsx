import { getOperationText } from '@/i18n/operation-text.server'
import { PostReturnButton } from './PostReturnButton'
import { receiptAccess } from './actions'
import { settlementAccess } from '@/features/settlements/actions'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { DocumentHeader, DocumentStatus, MoneySummary } from '@/components/operations/document-ui'
import { dayLabel, moneyLabel, unitPriceLabel } from '@/features/finance/presentation'
import { receiptTotal } from './money'
import type { serializeReturn } from './return-document'
export async function SupplierReturnDocument({
  document: d,
}: {
  document: ReturnType<typeof serializeReturn>
}) {
  const ot = await getOperationText()

  const [access, finance] = await Promise.all([receiptAccess(), settlementAccess()])
  return (
    <div className="space-y-6">
      <DocumentHeader
        title={ot("Повернення постачальнику № ") + d.number}
        back={{ href: '/suppliers/' + d.supplierId, label: d.supplier }}
        status={
          <DocumentStatus>
            {d.status === 'posted' ? ot('Проведено') : ot('Чернетка')}
          </DocumentStatus>
        }
        description={d.supplier + ' · ' + dayLabel(d.date)}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/supplier-returns">{ot('Усі повернення')}</Link>
            </Button>
            {d.status === 'draft' && access.post && finance.create && (
              <>
                <Button asChild variant="outline">
                  <Link href={'/supplier-returns/' + d.id + '/edit'}>
                    {ot('Редагувати чернетку')}
                  </Link>
                </Button>
                <PostReturnButton id={d.id} version={d.version} />
              </>
            )}
            <Button asChild variant="outline">
              <Link href={'/documents/return/' + d.id}>{ot('Пов’язані документи')}</Link>
            </Button>
          </>
        }
      />
      <MoneySummary
        items={[
          {
            label: ot('Сума повернення'),
            value: receiptTotal(d.lines),
            emphasis: true,
            hint:
              d.status === 'posted'
                ? ot('Зменшує загальну заборгованість перед постачальником')
                : ot(
                    'Чернетка: склад і борг ще не змінено. Для списання натисніть «Провести повернення».'
                  ),
          },
        ]}
      />
      <section className="ops-panel space-y-4">
        <div>
          <h2 className="text-sm text-muted-foreground">{ot('Номер документа постачальника')}</h2>
          <p className="mb-4 font-semibold break-words">{d.supplierDocumentNumber || '—'}</p>
          <h2 className="text-sm text-muted-foreground">{ot('Причина повернення')}</h2>
          <p>{d.reason}</p>
        </div>
        <div className="ops-table-scroll">
          <table>
            <thead>
              <tr>
                <th>{ot('Позиція')}</th>
                <th>{ot('Бренд')}</th>
                <th>{ot('Артикул')}</th>
                <th>{ot('Надходження')}</th>
                <th>{ot('Кількість')}</th>
                <th>{ot('Ціна закупівлі')}</th>
                <th>{ot('Сума повернення')}</th>
              </tr>
            </thead>
            <tbody>
              {d.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.name}</td>
                  <td>{l.brand || '—'}</td>
                  <td className="font-mono">{l.article || '—'}</td>
                  <td>
                    <Link className="underline" href={'/receipts/' + l.receiptId}>
                      {l.receiptNumber}
                    </Link>
                    <p className="text-xs text-muted-foreground">{dayLabel(l.receiptDate)}</p>
                  </td>
                  <td>
                    {l.quantity} {l.unit}
                  </td>
                  <td className="whitespace-nowrap">{unitPriceLabel(l.unitPrice)}</td>
                  <td className="whitespace-nowrap text-right font-semibold">
                    {moneyLabel(l.amount, ot('грн'))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
