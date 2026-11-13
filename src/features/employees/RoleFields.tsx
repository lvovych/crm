export const roles = { mechanic: 'Механік', parts: 'Запчастист', advisor: 'Приймальник', owner: 'Власник' }
export function RoleFields({ selected }: { selected: string[] }) {
  return (
    <fieldset className="flex flex-wrap gap-4">
      <legend className="sr-only">Робочі ролі</legend>
      {Object.entries(roles).map(([key, label]) => (
        <label key={key}>
          <input type="checkbox" name="roles" value={key} defaultChecked={selected.includes(key)} />{' '}
          {label}
        </label>
      ))}
    </fieldset>
  )
}
