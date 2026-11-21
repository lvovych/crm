'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { salaryPaymentOptions, paySalaryDocument } from './salary-payments'
import {
  payrollButton as button,
  payrollPrimary as primary,
  payrollControl as control,
  payrollField as field,
} from './IndividualRules'
import { payrollMoney } from './CommissionLines'

type Options = NonNullable<Awaited<ReturnType<typeof salaryPaymentOptions>>['data']>
export function SalaryPayment({ slipId }: { slipId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false),
    [pending, run] = useTransition()
  const [options, setOptions] = useState<Options | null>(null)
  const [amount, setAmount] = useState(''),
    [account, setAccount] = useState(''),
    [date, setDate] = useState('')
  const [requestId, setRequestId] = useState(''),
    [error, setError] = useState(''),
    [message, setMessage] = useState('')
  function show() {
    setOpen(true)
    setOptions(null)
    setError('')
    setMessage('')
    run(async () => {
      const result = await salaryPaymentOptions(slipId)
      if (!result.data) {
        setError(result.error || 'Не вдалося завантажити дані виплати.')
        return
      }
      setOptions(result.data)
      setAmount(result.data.remaining)
      setDate(result.data.today)
      setAccount(result.data.accounts.length === 1 ? result.data.accounts[0].id : '')
      setRequestId(crypto.randomUUID())
    })
  }
  function pay() {
    run(async () => {
      setError('')
      const result = await paySalaryDocument({ slipId, requestId, account, amount, date })
      if (!result.data) {
        setError(result.error || 'Не вдалося провести виплату.')
        return
      }
      setMessage('Виплату проведено по касі.')
      setOpen(false)
      router.refresh()
    })
  }
  return (
    <div className="space-y-2">
      <button className={primary} disabled={pending} onClick={show}>
        Провести виплату
      </button>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!pending) setOpen(value)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Виплата зарплати</DialogTitle>
            <DialogDescription>
              Видаток із каси буде зараховано саме на цей документ нарахування.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {!options ? (
            <p>{pending ? 'Завантаження…' : 'Закрийте вікно й спробуйте ще раз.'}</p>
          ) : Number(options.remaining) <= 0 ? (
            <p>За цим документом немає залишку до виплати.</p>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                pay()
              }}
            >
              <p className="text-sm">
                Залишок до виплати: <b>{payrollMoney(options.remaining)} грн</b>
              </p>
              {!options.accounts.length && <p role="alert">Немає доступної каси для виплати.</p>}
              <fieldset disabled={pending} className="space-y-4">
                <label className={field}>
                  Каса / рахунок
                  <select
                    className={control}
                    required
                    value={account}
                    onChange={(e) => setAccount(e.target.value)}
                  >
                    <option value="">Оберіть касу</option>
                    {options.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={field}>
                  Сума виплати, грн
                  <input
                    className={control}
                    required
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
                <label className={field}>
                  Дата виплати
                  <input
                    className={control}
                    required
                    type="date"
                    max={options.today}
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
                <label className={field}>
                  Стаття витрат
                  <input className={control} readOnly value={options.categoryName} />
                </label>
                <div className="flex flex-wrap gap-3">
                  <button type="button" className={button} onClick={() => setOpen(false)}>
                    Скасувати
                  </button>
                  <button className={primary} disabled={!options.accounts.length}>
                    {pending ? 'Проведення…' : 'Підтвердити виплату'}
                  </button>
                </div>
              </fieldset>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
