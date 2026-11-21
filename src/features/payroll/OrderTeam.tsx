import { getOperationText } from '@/i18n/operation-text.server'
import { orderTeam, saveOrderTeam } from './actions'
export async function OrderTeam({ id }: { id: string }) {
  const ot = await getOperationText()

  const result = await orderTeam(id)
  if (!result.data?.order) return null
  const { order, people } = result.data
  const options = people.map((p) => (
    <option key={p.id} value={p.id}>
      {p.name}
    </option>
  ))
  return (
    <details open className="m-4 rounded-lg border p-4">
      <summary className="font-semibold">Команда наряду · нарахування зарплати</summary>
      <form action={saveOrderTeam} className="my-2 grid gap-3">
        <input type="hidden" name="order" value={id} />
        <label>
          {ot('Запчастист наряду')}{' '}
          <select defaultValue={order.payAssignment?.partsId || ''} name="partsId">
            <option value="">{ot('Не призначено')}</option>
            {options}
          </select>
        </label>
        <label>
          Менеджер наряду{' '}
          <select defaultValue={order.payAssignment?.ownerId || ''} name="ownerId">
            <option value="">{ot('Не призначено')}</option>
            {options}
          </select>
        </label>
        {order.partItems.map((p) => (
          <label key={p.id}>
            {p.name}{' '}
            <select defaultValue={p.payrollSellerId || ''} name={'part-' + p.id}>
              <option value="">{ot('Запчастист наряду')}</option>
              {options}
            </select>
          </label>
        ))}
        <button className="w-fit rounded border px-3 py-1">{ot('Зберегти призначення')}</button>
      </form>
    </details>
  )
}
