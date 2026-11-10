import { financeReport } from '@/features/finance/actions'
import { FinanceClient } from '@/features/finance/FinanceClient'
import { getAuthContext } from '@/lib/get-auth-context'
import { workshopTimeZone } from '@/lib/workshop-timezone'
import { zonedDayKey } from '@/lib/timezone'
export default async function FinanceSettingsPage() {
  const ctx = await getAuthContext()
  const today = zonedDayKey(
    new Date(),
    ctx ? await workshopTimeZone(ctx.organizationId) : 'Europe/Kyiv'
  )
  const result = await financeReport(today, true)
  if (!result.success || !result.data || !result.data.isAdmin)
    return (
      <div className="p-6" role="alert">
        Немає доступу до налаштувань кас.
      </div>
    )
  return <FinanceClient settingsOnly initial={result.data} today={today} />
}
