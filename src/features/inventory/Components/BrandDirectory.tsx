'use client'
import { useOperationText } from '@/i18n/use-operation-text'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { saveBrand, changeBrandAvailability } from '../Actions/manageBrands'
type Brand = { id: string; name: string; isActive: boolean }
export function BrandDirectory({
  brands,
  canCreate,
  canEdit,
  canDelete,
}: {
  brands: Brand[]
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
}) {
  const ot = useOperationText()

  const [query, setQuery] = useState(''),
    [editing, setEditing] = useState<Brand | null>(null),
    [message, setMessage] = useState(''),
    [pending, start] = useTransition()
  const router = useRouter()
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        {ot(
          'Спільний довідник виробників для карток товарів. Зміни застосовуються до всіх організацій. Видалення деактивує бренд для нових товарів; існуючі картки та історія зберігаються. Доступ визначається правами ролі.'
        )}
      </p>
      <div className="flex gap-3">
        <Input
          aria-label={ot('Пошук бренду')}
          placeholder={ot('Знайти бренд')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {canCreate && (
          <Button onClick={() => setEditing({ id: '', name: '', isActive: true })}>
            {ot('Додати бренд')}
          </Button>
        )}
      </div>
      {editing && (
        <form
          className="rounded-xl border-2 p-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            start(async () => {
              const r = await saveBrand({ ...editing, id: editing.id || undefined })
              setMessage(r.success ? ot('Бренд збережено') : r.error || ot('Помилка'))
              if (r.success) {
                setEditing(null)
                router.refresh()
              }
            })
          }}
        >
          <h2 className="font-semibold">
            {editing.id ? ot('Редагування бренду') : ot('Новий бренд')}
          </h2>
          <label className="block">
            {ot('Назва')}
            <Input
              required
              maxLength={120}
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
          </label>
          <div className="flex gap-2">
            <Button disabled={pending}>{ot('Зберегти')}</Button>
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>
              {ot('Скасувати')}
            </Button>
          </div>
        </form>
      )}
      {message && <p role="status">{message}</p>}
      <div className="rounded-xl border overflow-auto">
        <table className="w-full text-left">
          <thead className="bg-muted">
            <tr>
              <th className="p-3">{ot('Бренд')}</th>
              <th className="p-3">{ot('Статус')}</th>
              {(canEdit || canDelete) && <th className="p-3">{ot('Дія')}</th>}
            </tr>
          </thead>
          <tbody>
            {brands
              .filter((b) => b.name.toLowerCase().includes(query.toLowerCase()))
              .map((b) => (
                <tr key={b.id} className="border-t">
                  <td className="p-3">{b.name}</td>
                  <td className="p-3">{b.isActive ? ot('Активний') : ot('Неактивний')}</td>
                  {(canEdit || canDelete) && (
                    <td className="p-3">
                      {canEdit && (
                        <Button
                          variant="outline"
                          disabled={b.id === 'brand_unknown'}
                          onClick={() => setEditing(b)}
                        >
                          {ot('Редагувати')}
                        </Button>
                      )}
                      {b.id !== 'brand_unknown' &&
                        ((b.isActive && canDelete) || (!b.isActive && canEdit)) && (
                          <Button
                            type="button"
                            variant="outline"
                            className="ml-2"
                            disabled={pending}
                            onClick={() =>
                              start(async () => {
                                const r = await changeBrandAvailability(b.id, !b.isActive)
                                setMessage(
                                  r.success
                                    ? b.isActive
                                      ? ot('Бренд деактивовано')
                                      : ot('Бренд відновлено')
                                    : r.error || ot('Помилка')
                                )
                                if (r.success) router.refresh()
                              })
                            }
                          >
                            {b.isActive ? ot('Видалити (деактивувати)') : ot('Відновити')}
                          </Button>
                        )}
                    </td>
                  )}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
