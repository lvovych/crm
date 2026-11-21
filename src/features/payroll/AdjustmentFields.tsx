import type { SalaryAdjustment } from './adjustments'
import {
  payrollButton as button,
  payrollControl as control,
  payrollField as field,
} from './IndividualRules'

export function AdjustmentFields({
  rows,
  onChange,
}: {
  rows: SalaryAdjustment[]
  onChange: (rows: SalaryAdjustment[]) => void
}) {
  function change(id: string, patch: Partial<SalaryAdjustment>) {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }
  return (
    <section className="space-y-4 border-t pt-5" aria-label="Премії та утримання">
      <div>
        <h3 className="font-semibold">Премії та утримання</h3>
        <p className="text-sm text-muted-foreground">
          Необов’язково. Вкажіть додатну суму: премія додається, утримання віднімається.
        </p>
      </div>
      {rows.map((row, i) => (
        <div key={row.id} className="space-y-3 rounded-lg border p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={field}>
              Тип
              <select
                aria-label={`Тип коригування ${i + 1}`}
                className={control}
                value={row.type}
                onChange={(e) =>
                  change(row.id, { type: e.target.value as SalaryAdjustment['type'] })
                }
              >
                <option value="bonus">Премія (+)</option>
                <option value="deduction">Утримання (−)</option>
              </select>
            </label>
            <label className={field}>
              Сума, грн
              <input
                aria-label={`Сума коригування ${i + 1}`}
                className={control}
                inputMode="decimal"
                required
                value={row.amount}
                onChange={(e) => change(row.id, { amount: e.target.value })}
                placeholder="0,00"
              />
            </label>
          </div>
          <label className={field}>
            Пояснення
            <input
              aria-label={`Пояснення коригування ${i + 1}`}
              className={control}
              required
              maxLength={500}
              value={row.reason}
              onChange={(e) => change(row.id, { reason: e.target.value })}
            />
          </label>
          <button
            type="button"
            className="text-sm underline"
            aria-label={`Видалити коригування ${i + 1}`}
            onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
          >
            Видалити рядок
          </button>
        </div>
      ))}
      <div className="flex flex-wrap gap-3">
        {(['bonus', 'deduction'] as const).map((type) => (
          <button
            key={type}
            type="button"
            disabled={rows.length >= 100}
            className={button}
            onClick={() =>
              onChange([...rows, { id: crypto.randomUUID(), type, amount: '', reason: '' }])
            }
          >
            {type === 'bonus' ? '+ Додати премію' : '− Додати утримання'}
          </button>
        ))}
      </div>
    </section>
  )
}
