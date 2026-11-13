import { orderTeam, saveOrderTeam } from './actions'
export async function OrderTeam({ id }: { id: string }) {
  const result = await orderTeam(id)
  if (!result.data?.order) return null
  const { order, people } = result.data
  const options = people.map((p) => (
    <option key={p.id} value={p.id}>
      {p.name}
    </option>
  ))
  return (
    <details className="m-4 rounded border p-4">
      <summary>Працівники для розрахунку зарплати</summary>
      <form action={saveOrderTeam} className="my-2 grid gap-3">
        <input type="hidden" name="order" value={id} />
        <label>
          Запчастист наряду{' '}
          <select defaultValue={order.payAssignment?.partsId || ''} name="partsId">
            <option value="">Не призначено</option>
            {options}
          </select>
        </label>
        <label>
          Частка від маржі всього наряду{' '}
          <select defaultValue={order.payAssignment?.ownerId || ''} name="ownerId">
            <option value="">Не призначено</option>
            {options}
          </select>
        </label>
        {order.partItems.map((p) => (
          <label key={p.id}>
            {p.name}{' '}
            <select defaultValue={p.payrollSellerId || ''} name={'part-' + p.id}>
              <option value="">Запчастист наряду</option>
              {options}
            </select>
          </label>
        ))}
        <button className="w-fit rounded border px-3 py-1">Зберегти призначення</button>
      </form>
    </details>
  )
}
