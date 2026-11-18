'use client'
import { useOperationText } from '@/i18n/use-operation-text'
import { returnReasons } from './return-reasons'

export function ReturnReasonSelect({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const ot = useOperationText()

  return (
    <label className="grid gap-2 text-sm font-medium">
      {ot('Причина повернення')}
      <select
        required
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-md border bg-background px-3"
      >
        <option value="" disabled>
          {ot('Оберіть причину')}
        </option>
        {returnReasons.map((reason) => (
          <option key={ot(reason)} value={ot(reason)}>
            {ot(reason)}
          </option>
        ))}
      </select>
    </label>
  )
}
