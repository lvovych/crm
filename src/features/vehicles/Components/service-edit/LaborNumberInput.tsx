'use client'
import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { parseLaborNumber } from '@/features/labor-presets/Lib/quickLabor'

/** Keep partial decimal input local; commit only a complete, valid value. */
export function LaborNumberInput({
  value,
  label,
  disabled,
  onCommit,
}: {
  value: number
  label: string
  disabled?: boolean
  onCommit: (value: number) => void
}) {
  const [text, setText] = useState(String(value)),
    [invalid, setInvalid] = useState(false)
  useEffect(() => {
    setText(String(value))
    setInvalid(false)
  }, [value])
  return (
    <Input
      aria-label={label}
      aria-invalid={invalid}
      className="min-h-11 text-base tabular-nums"
      inputMode="decimal"
      value={text}
      disabled={disabled}
      onInput={(event) => event.stopPropagation()}
      onChange={(event) => {
        setText(event.target.value)
        setInvalid(false)
      }}
      onBlur={() => {
        const next = parseLaborNumber(text)
        if (next === null) {
          setInvalid(true)
          return
        }
        if (next !== value) onCommit(next)
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter') {
          event.preventDefault()
          event.stopPropagation()
          event.currentTarget.blur()
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          setText(String(value))
          setInvalid(false)
        }
      }}
    />
  )
}
