'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { saveBrand } from '../Actions/manageBrands'
type Brand = { id: string; name: string; isActive: boolean }
export function BrandDirectory({ brands, canEdit }: { brands: Brand[]; canEdit: boolean }) {
  const [query, setQuery] = useState(''),
    [editing, setEditing] = useState<Brand | null>(null),
    [message, setMessage] = useState(''),
    [pending, start] = useTransition()
  const router = useRouter()
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        Спільний довідник виробників для карток товарів.{' '}
        {canEdit
          ? 'Зміни назви застосовуються до карток товарів усіх організацій. Історичні назви в нарядах зберігаються.'
          : 'Редагування доступне системному адміністратору.'}
      </p>
      <div className="flex gap-3">
        <Input
          aria-label="Пошук бренду"
          placeholder="Знайти бренд"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {canEdit && (
          <Button onClick={() => setEditing({ id: '', name: '', isActive: true })}>
            Додати бренд
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
              setMessage(r.success ? 'Бренд збережено' : r.error || 'Помилка')
              if (r.success) {
                setEditing(null)
                router.refresh()
              }
            })
          }}
        >
          <h2 className="font-semibold">{editing.id ? 'Редагування бренду' : 'Новий бренд'}</h2>
          <label className="block">
            Назва
            <Input
              required
              maxLength={120}
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
          </label>
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={editing.isActive}
              onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })}
            />
            Доступний для нових товарів
          </label>
          <div className="flex gap-2">
            <Button disabled={pending}>Зберегти</Button>
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>
              Скасувати
            </Button>
          </div>
        </form>
      )}
      {message && <p role="status">{message}</p>}
      <div className="rounded-xl border overflow-auto">
        <table className="w-full text-left">
          <thead className="bg-muted">
            <tr>
              <th className="p-3">Бренд</th>
              <th className="p-3">Статус</th>
              {canEdit && <th className="p-3">Дія</th>}
            </tr>
          </thead>
          <tbody>
            {brands
              .filter((b) => b.name.toLowerCase().includes(query.toLowerCase()))
              .map((b) => (
                <tr key={b.id} className="border-t">
                  <td className="p-3">{b.name}</td>
                  <td className="p-3">{b.isActive ? 'Активний' : 'Неактивний'}</td>
                  {canEdit && (
                    <td className="p-3">
                      <Button
                        variant="outline"
                        disabled={b.id === 'brand_unknown'}
                        onClick={() => setEditing(b)}
                      >
                        Редагувати
                      </Button>
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
