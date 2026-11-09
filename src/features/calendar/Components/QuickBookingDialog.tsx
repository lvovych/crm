'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { VehiclePickerSearch } from '@/components/vehicle-picker-search'
import { VehiclePickerDialog } from '@/components/vehicle-picker-dialog'
import type { VehiclePickerOption } from '@/features/vehicles/Lib/vehiclePickerSearch'
import { useServiceType } from '@/components/service-type-context'
import { getTechnicians } from '@/features/workboard/Actions/technicianActions'
import { getWorkBays } from '@/features/workboard/Actions/workBayActions'
import { createQuickBooking } from '../Actions/quickBookingActions'

export function QuickBookingDialog({
  open,
  onOpenChange,
  date,
  time,
  vehicles,
  customers,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  date: string
  time?: string
  vehicles: VehiclePickerOption[]
  customers: { id: string; name: string; company: string | null }[]
  onSaved: (id: string, date: string) => void
}) {
  const t = useTranslations('calendar.quickBooking')
  const router = useRouter()
  const isMarine = useServiceType() === 'marine'
  const [query, setQuery] = useState('')
  const [vehicleId, setVehicleId] = useState('')
  const [reason, setReason] = useState('')
  const [day, setDay] = useState(date)
  const [start, setStart] = useState(time || '09:00')
  const [duration, setDuration] = useState('60')
  const [technicianId, setTechnicianId] = useState('')
  const [workBayId, setWorkBayId] = useState('')
  const [resources, setResources] = useState<{
    technicians: { id: string; name: string }[]
    bays: { id: string; name: string }[]
  }>({ technicians: [], bays: [] })
  const [creatingVehicle, setCreatingVehicle] = useState(false)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const requestId = useRef('')
  const [error, setError] = useState('')
  const [openRecord, setOpenRecord] = useState(false)
  useEffect(() => {
    if (!open) return
    requestId.current = crypto.randomUUID()
    setQuery('')
    setVehicleId('')
    setReason('')
    setDay(date)
    setStart(time || '09:00')
    setDuration('60')
    setTechnicianId('')
    setWorkBayId('')
    setError('')
    setOpenRecord(false)
    let active = true
    Promise.all([getTechnicians(), getWorkBays()])
      .then(([techs, bays]) => {
        if (active)
          setResources({
            technicians: techs.success ? (techs.data ?? []) : [],
            bays: bays.success ? (bays.data ?? []) : [],
          })
      })
      .catch(() => {
        if (active) setResources({ technicians: [], bays: [] })
      })
    return () => {
      active = false
    }
  }, [open, date, time])
  const vehicle = vehicles.find((v) => v.id === vehicleId)
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!pending.current) onOpenChange(next)
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          className="flex max-h-[92dvh] flex-col overflow-hidden p-4 max-sm:inset-0 max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none sm:max-w-xl [&>[data-slot=dialog-close]]:size-11"
        >
          <DialogHeader className="pr-10 text-left">
            <DialogTitle>{t('title')}</DialogTitle>
          </DialogHeader>
          {!vehicleId ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <VehiclePickerSearch
                vehicles={vehicles}
                query={query}
                onQueryChange={setQuery}
                onSelect={setVehicleId}
                onCreate={() => setCreatingVehicle(true)}
                isMarine={isMarine}
              />
            </div>
          ) : (
            <form
              className="flex min-h-0 flex-col gap-4 overflow-y-auto"
              onSubmit={async (event) => {
                event.preventDefault()
                if (pending.current) return
                pending.current = true
                setBusy(true)
                setError('')
                try {
                  const result = await createQuickBooking({
                    requestId: requestId.current,
                    vehicleId,
                    reason,
                    date: day,
                    time: start,
                    duration: Number(duration),
                    technicianId,
                    workBayId,
                  })
                  if (!result.success || !result.data) {
                    setError(t('error'))
                    return
                  }
                  toast.success(t('saved'))
                  onSaved(result.data.id, day)
                  onOpenChange(false)
                  if (openRecord) router.push(`/vehicles/${vehicleId}/service/${result.data.id}`)
                } catch {
                  setError(t('error'))
                } finally {
                  pending.current = false
                  setBusy(false)
                }
              }}
            >
              <fieldset disabled={busy} className="space-y-4">
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="font-semibold">
                    {vehicle
                      ? [vehicle.licensePlate, vehicle.make, vehicle.model]
                          .filter(Boolean)
                          .join(' · ')
                      : t('selectedVehicle')}
                  </p>
                  <p className="text-sm text-muted-foreground">{vehicle?.customer?.name}</p>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-2 min-h-11"
                    onClick={() => setVehicleId('')}
                  >
                    {t('changeVehicle')}
                  </Button>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="booking-reason">{t('reason')}</Label>
                  <Input
                    id="booking-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    required
                    maxLength={2000}
                    autoFocus
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="min-w-0 space-y-1">
                    <Label htmlFor="booking-date">{t('date')}</Label>
                    <Input
                      id="booking-date"
                      type="date"
                      value={day}
                      onChange={(e) => setDay(e.target.value)}
                      required
                    />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <Label htmlFor="booking-time">{t('time')}</Label>
                    <Input
                      id="booking-time"
                      type="time"
                      value={start}
                      onChange={(e) => setStart(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="booking-duration">{t('duration')}</Label>
                  <select
                    id="booking-duration"
                    className="h-11 w-full rounded-md border bg-background px-3"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                  >
                    {[15, 30, 45, 60, 90, 120, 180, 240, 480].map((value) => (
                      <option key={value} value={value}>
                        {t('minutes', { count: value })}
                      </option>
                    ))}
                  </select>
                </div>
                <details className="rounded-lg border p-3">
                  <summary className="cursor-pointer py-1 font-medium">{t('resources')}</summary>
                  <div className="mt-3 space-y-3">
                    <div>
                      <Label htmlFor="booking-mechanic">{t('mechanic')}</Label>
                      <select
                        id="booking-mechanic"
                        className="h-11 w-full rounded-md border bg-background px-3"
                        value={technicianId}
                        onChange={(e) => setTechnicianId(e.target.value)}
                      >
                        <option value="">{t('defaultMechanic')}</option>
                        {resources.technicians.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="booking-bay">{t('bay')}</Label>
                      <select
                        id="booking-bay"
                        className="h-11 w-full rounded-md border bg-background px-3"
                        value={workBayId}
                        onChange={(e) => setWorkBayId(e.target.value)}
                      >
                        <option value="">{t('noBay')}</option>
                        {resources.bays.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </details>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={openRecord}
                    onChange={(e) => setOpenRecord(e.target.checked)}
                  />
                  {t('openAfterSave')}
                </label>
              </fieldset>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <div className="sticky bottom-0 flex gap-2 border-t bg-background pt-3 pb-2">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={busy}
                  onClick={() => onOpenChange(false)}
                >
                  {t('cancel')}
                </Button>
                <Button type="submit" className="min-h-11 flex-1" disabled={busy}>
                  {busy ? t('saving') : t('save')}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <VehiclePickerDialog
        open={creatingVehicle}
        onOpenChange={setCreatingVehicle}
        vehicles={vehicles}
        customers={customers}
        onVehicleSelected={(id) => {
          setVehicleId(id)
          router.refresh()
        }}
      />
    </>
  )
}
