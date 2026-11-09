'use client'

import { useState, useEffect, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, ArrowLeft, UserPlus } from 'lucide-react'
import { createVehicle } from '@/features/vehicles/Actions/vehicleActions'
import { createDraftCounterSale } from '@/features/vehicles/Actions/createDraftServiceRecord'
import { CustomerCombobox } from '@/features/quotes/Components/CustomerCombobox'
import { createCustomer } from '@/features/customers/Actions/customerActions'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { handleGated } from '@/components/upgrade-gate'
import { useServiceType } from '@/components/service-type-context'
import {
  VehicleCatalogFields,
  EMPTY_VEHICLE_IDENTITY,
} from '@/features/vehicles/Components/VehicleCatalogFields'
import { VehiclePickerSearch } from '@/components/vehicle-picker-search'
import { REGISTRATION_COLORS } from '@/features/vehicles/Lib/vehicleCatalog'

import { type VehiclePickerOption as Vehicle } from '@/features/vehicles/Lib/vehiclePickerSearch'

interface Customer {
  id: string
  name: string
  company: string | null
}

interface VehiclePickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  vehicles: Vehicle[]
  customers: Customer[]
  title?: string
  onVehicleSelected?: (id: string) => void
  redirectQuery?: Record<string, string>
}

export function VehiclePickerDialog({
  open,
  onOpenChange,
  vehicles,
  customers,
  title,
  redirectQuery,
  onVehicleSelected,
}: VehiclePickerDialogProps) {
  const router = useRouter()
  const t = useTranslations('workOrders.vehiclePicker')
  const tc = useTranslations('common.buttons')
  const isMarine = useServiceType() === 'marine'
  // Every caller's own title speaks of vehicles, so a marine workshop gets the
  // picker's vessel title whatever was passed.
  const displayTitle = isMarine ? t('titleMarine') : title || t('title')

  const [vehicleSearch, setVehicleSearch] = useState('')
  const [pickerStep, setPickerStep] = useState<'select' | 'create' | 'sale'>('select')

  const [identity, setIdentity] = useState(EMPTY_VEHICLE_IDENTITY)
  const { make: newMake, model: newModel } = identity
  const [newVin, setNewVin] = useState('')
  const [newColor, setNewColor] = useState('')
  const [newYear, setNewYear] = useState('')
  const [newPlate, setNewPlate] = useState('')
  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [showNewCustomer, setShowNewCustomer] = useState(false)
  const [newCustomerName, setNewCustomerName] = useState('')
  const [newCustomerPhone, setNewCustomerPhone] = useState('')
  const [creating, setCreating] = useState(false)

  const [viewport, setViewport] = useState<{ height: number; top: number } | null>(null)
  useEffect(() => {
    if (!open) return
    const visual = window.visualViewport
    const update = () =>
      setViewport({ height: visual?.height ?? window.innerHeight, top: visual?.offsetTop ?? 0 })
    update()
    visual?.addEventListener('resize', update)
    visual?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      visual?.removeEventListener('resize', update)
      visual?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [open])

  const resetState = () => {
    setPickerStep('select')
    setVehicleSearch('')
    setIdentity(EMPTY_VEHICLE_IDENTITY)
    setNewVin('')
    setNewColor('')
    setNewYear('')
    setNewPlate('')
    setSelectedCustomerId('')
    setShowNewCustomer(false)
    setNewCustomerName('')
    setNewCustomerPhone('')
    setCreating(false)
  }

  const handleCreateSale = async () => {
    if (showNewCustomer && !newCustomerName.trim()) {
      toast.error(t('customerNameRequired'))
      return
    }
    if (!showNewCustomer && !selectedCustomerId) return

    setCreating(true)
    try {
      let customerId = selectedCustomerId

      if (showNewCustomer && newCustomerName.trim()) {
        const customerResult = await createCustomer({
          name: newCustomerName.trim(),
          phone: newCustomerPhone.trim() || undefined,
        })
        if (!customerResult.success || !customerResult.data) {
          if (!handleGated(customerResult)) {
            toast.error(customerResult.error || t('failedCreateCustomer'))
          }
          setCreating(false)
          return
        }
        customerId = customerResult.data.id
      }

      const result = await createDraftCounterSale(customerId)
      if (!result.success || !result.data) {
        toast.error(result.error || t('somethingWentWrong'))
        setCreating(false)
        return
      }

      onOpenChange(false)
      resetState()
      router.push(`/sales/${result.data.id}`)
    } catch {
      toast.error(t('somethingWentWrong'))
      setCreating(false)
    }
  }

  const handleSelect = (vehicleId: string) => {
    onOpenChange(false)
    resetState()
    if (onVehicleSelected) {
      onVehicleSelected(vehicleId)
      return
    }
    const qs = redirectQuery ? '?' + new URLSearchParams(redirectQuery).toString() : ''
    router.push(`/vehicles/${vehicleId}/service/new${qs}`)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen)
    if (!nextOpen) resetState()
  }

  const handleQuickCreate = async () => {
    if (!newMake.trim() || !newModel.trim() || !newYear.trim()) return
    if (creating) return
    const yearNum = Number(newYear)
    if (!Number.isInteger(yearNum) || yearNum < 1900 || yearNum > new Date().getFullYear() + 2) {
      toast.error(t('invalidYear'))
      return
    }
    if (showNewCustomer && !newCustomerName.trim()) {
      toast.error(t('customerNameRequired'))
      return
    }

    setCreating(true)
    try {
      let customerId = selectedCustomerId || undefined

      if (showNewCustomer && newCustomerName.trim()) {
        const customerResult = await createCustomer({
          name: newCustomerName.trim(),
          phone: newCustomerPhone.trim() || undefined,
        })
        if (!customerResult.success || !customerResult.data) {
          if (!handleGated(customerResult)) {
            toast.error(customerResult.error || t('failedCreateCustomer'))
          }
          setCreating(false)
          return
        }
        customerId = customerResult.data.id
      }

      const vehicleResult = await createVehicle({
        make: newMake.trim(),
        model: newModel.trim(),
        year: yearNum,
        ...(!isMarine
          ? {
              vin: newVin.trim().toUpperCase() || undefined,
              color: newColor || undefined,
              generation: identity.generation || undefined,
              modification: identity.modification || undefined,
              engineSize: identity.engineSize || undefined,
            }
          : {}),
        licensePlate: newPlate.trim() || undefined,
        customerId,
      })
      if (!vehicleResult.success || !vehicleResult.data) {
        toast.error(
          vehicleResult.error ||
            (isMarine ? t('failedCreateVehicleMarine') : t('failedCreateVehicle'))
        )
        setCreating(false)
        return
      }

      handleSelect(vehicleResult.data.id)
    } catch {
      toast.error(t('somethingWentWrong'))
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={
          pickerStep === 'select'
            ? 'top-[calc(var(--picker-top,0px)+0.5rem)] flex h-[calc(var(--picker-height,100dvh)-1rem)] max-h-none w-[calc(100%-1rem)] max-w-none translate-y-0 flex-col overflow-hidden p-4 sm:top-1/2 sm:h-auto sm:max-h-[85dvh] sm:w-[640px] sm:max-w-[calc(100%-3rem)] sm:-translate-y-1/2 sm:p-6 [&>[data-slot=dialog-close]]:top-1 [&>[data-slot=dialog-close]]:right-1 [&>[data-slot=dialog-close]]:flex [&>[data-slot=dialog-close]]:size-11 [&>[data-slot=dialog-close]]:items-center [&>[data-slot=dialog-close]]:justify-center'
            : 'w-[calc(100%-1rem)] max-w-md max-h-[90dvh] overflow-y-auto p-4 sm:p-6'
        }
        style={
          viewport
            ? ({
                '--picker-height': `${viewport.height}px`,
                '--picker-top': `${viewport.top}px`,
              } as CSSProperties)
            : undefined
        }
        aria-describedby={undefined}
      >
        {pickerStep === 'select' ? (
          <>
            <DialogHeader
              className={`shrink-0 pr-7 text-left ${viewport && viewport.height < 500 ? 'max-sm:sr-only' : ''}`}
            >
              <DialogTitle className="text-base leading-6 sm:text-lg">{displayTitle}</DialogTitle>
            </DialogHeader>
            <VehiclePickerSearch
              compact={!!viewport && viewport.height < 500}
              vehicles={vehicles}
              query={vehicleSearch}
              onQueryChange={setVehicleSearch}
              onSelect={handleSelect}
              onCreate={() => setPickerStep('create')}
              onSale={onVehicleSelected ? undefined : () => setPickerStep('sale')}
              isMarine={isMarine}
            />
          </>
        ) : pickerStep === 'sale' ? (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => setPickerStep('select')}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <DialogTitle>{t('partsSale')}</DialogTitle>
              </div>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {isMarine ? t('partsSaleDescriptionMarine') : t('partsSaleDescription')}
              </p>
              <div className="space-y-1.5">
                <Label>{t('customer')}</Label>
                {!showNewCustomer ? (
                  <>
                    <CustomerCombobox
                      value={selectedCustomerId}
                      placeholder={t('selectCustomer')}
                      noneLabel={t('none')}
                      onChange={(id) => setSelectedCustomerId(id)}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-xs text-muted-foreground"
                      onClick={() => {
                        setShowNewCustomer(true)
                        setSelectedCustomerId('')
                      }}
                    >
                      <UserPlus className="h-3.5 w-3.5 mr-1" />
                      {t('createNewCustomer')}
                    </Button>
                  </>
                ) : (
                  <div className="space-y-3 rounded-md border p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">{t('newCustomer')}</p>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          setShowNewCustomer(false)
                          setNewCustomerName('')
                          setNewCustomerPhone('')
                        }}
                      >
                        {tc('cancel')}
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="sale-customer-name">{t('customerName')}</Label>
                        <Input
                          id="sale-customer-name"
                          placeholder={t('customerNamePlaceholder')}
                          value={newCustomerName}
                          onChange={(e) => setNewCustomerName(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="sale-customer-phone">{t('phone')}</Label>
                        <Input
                          id="sale-customer-phone"
                          placeholder={t('phonePlaceholder')}
                          value={newCustomerPhone}
                          onChange={(e) => setNewCustomerPhone(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <Button
                className="w-full"
                disabled={
                  creating || (showNewCustomer ? !newCustomerName.trim() : !selectedCustomerId)
                }
                onClick={handleCreateSale}
              >
                {creating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    {t('creating')}
                  </>
                ) : (
                  t('createSale')
                )}
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => setPickerStep('select')}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <DialogTitle>
                  {isMarine ? t('addNewVehicleMarine') : t('addNewVehicle')}
                </DialogTitle>
              </div>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                void handleQuickCreate()
              }}
            >
              <fieldset disabled={creating} className="min-w-0 space-y-4">
                {isMarine ? (
                  <>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="new-make">{isMarine ? t('makeMarine') : t('make')}</Label>
                        <Input
                          id="new-make"
                          placeholder={isMarine ? 'e.g. Boston Whaler' : 'e.g. Toyota'}
                          value={newMake}
                          onChange={(e) =>
                            setIdentity({ ...EMPTY_VEHICLE_IDENTITY, make: e.target.value })
                          }
                          autoFocus
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="new-model">{t('model')}</Label>
                        <Input
                          id="new-model"
                          placeholder={isMarine ? 'e.g. Montauk 170' : 'e.g. Camry'}
                          value={newModel}
                          onChange={(e) => setIdentity({ ...identity, model: e.target.value })}
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <VehicleCatalogFields value={identity} onChange={setIdentity} />
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="new-year">{t('year')}</Label>
                    <Input
                      id="new-year"
                      className="min-h-11 text-base"
                      inputMode="numeric"
                      type="number"
                      placeholder={`e.g. ${new Date().getFullYear()}`}
                      value={newYear}
                      onChange={(e) => setNewYear(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-plate">
                      {isMarine ? t('licensePlateMarine') : t('licensePlate')}
                    </Label>
                    <Input
                      id="new-plate"
                      className="min-h-11 text-base"
                      placeholder="e.g. ABC-1234"
                      value={newPlate}
                      onChange={(e) => setNewPlate(e.target.value)}
                    />
                  </div>
                </div>
                {!isMarine && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="new-vin">{t('catalog.vin')}</Label>
                      <Input
                        id="new-vin"
                        value={newVin}
                        maxLength={17}
                        autoCapitalize="characters"
                        autoCorrect="off"
                        spellCheck={false}
                        className="min-h-11 text-base font-mono uppercase"
                        onChange={(e) => setNewVin(e.target.value.toUpperCase().replace(/\s/g, ''))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="new-color">{t('catalog.color')}</Label>
                      <Select
                        value={newColor || '__none__'}
                        onValueChange={(color) => setNewColor(color === '__none__' ? '' : color)}
                      >
                        <SelectTrigger id="new-color" className="min-h-11 w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__" className="min-h-11">
                            {t('catalog.noColor')}
                          </SelectItem>
                          {REGISTRATION_COLORS.map((color) => (
                            <SelectItem
                              key={color}
                              className="min-h-11"
                              value={t(`catalog.colors.${color}`)}
                            >
                              {t(`catalog.colors.${color}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>{t('customer')}</Label>
                  {!showNewCustomer ? (
                    <Select
                      value={selectedCustomerId}
                      onValueChange={(val) => {
                        if (val === '__new__') {
                          setShowNewCustomer(true)
                          setSelectedCustomerId('')
                        } else {
                          setSelectedCustomerId(val)
                        }
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t('selectCustomer')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__new__">
                          <span className="flex items-center gap-1.5">
                            <UserPlus className="h-3.5 w-3.5" />
                            {t('createNewCustomer')}
                          </span>
                        </SelectItem>
                        {customers.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                            {c.company ? ` (${c.company})` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="space-y-3 rounded-md border p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">{t('newCustomer')}</p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => {
                            setShowNewCustomer(false)
                            setNewCustomerName('')
                            setNewCustomerPhone('')
                          }}
                        >
                          {tc('cancel')}
                        </Button>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="new-customer-name">{t('customerName')}</Label>
                          <Input
                            id="new-customer-name"
                            placeholder={t('customerNamePlaceholder')}
                            value={newCustomerName}
                            onChange={(e) => setNewCustomerName(e.target.value)}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="new-customer-phone">{t('phone')}</Label>
                          <Input
                            id="new-customer-phone"
                            placeholder={t('phonePlaceholder')}
                            value={newCustomerPhone}
                            onChange={(e) => setNewCustomerPhone(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <Button
                  className="w-full min-h-11"
                  disabled={
                    creating ||
                    !newMake.trim() ||
                    !newModel.trim() ||
                    !newYear.trim() ||
                    (showNewCustomer && !newCustomerName.trim())
                  }
                  type="submit"
                >
                  {creating ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      {t('creating')}
                    </>
                  ) : (
                    t('createAndContinue')
                  )}
                </Button>
              </fieldset>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
