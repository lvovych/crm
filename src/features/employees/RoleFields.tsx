import { useOperationText } from '@/i18n/use-operation-text'
export const roles = {
  mechanic: 'Механік',
  parts: 'Запчастист',
  advisor: 'Менеджер',
  owner: 'Власник',
}
export function RoleFields({ selected }: { selected: string[] }) {
  const ot = useOperationText()

  return (
    <fieldset className="flex flex-wrap gap-4">
      <legend className="mb-2 font-medium">{ot('Робочі ролі')}</legend>
      {Object.entries(roles).map(([key, label]) => (
        <label key={key}>
          <input type="checkbox" name="roles" value={key} defaultChecked={selected.includes(key)} />{' '}
          {ot(label)}
        </label>
      ))}
    </fieldset>
  )
}
