'use client'
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
  return (
    <label className="grid gap-2 text-sm font-medium">
      Причина повернення
      <select
        required
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-md border bg-background px-3"
      >
        <option value="" disabled>
          Оберіть причину
        </option>
        {returnReasons.map((reason) => (
          <option key={reason} value={reason}>
            {reason}
          </option>
        ))}
      </select>
    </label>
  )
}
