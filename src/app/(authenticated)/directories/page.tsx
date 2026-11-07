import Link from 'next/link'
import { PageHeader } from '@/components/page-header'
import { withAuth } from '@/lib/with-auth'
import { getCachedMembership } from '@/lib/cached-session'
import { Users, Car, Layers, Package } from 'lucide-react'

const directories = [
  {
    title: 'Бренди',
    description: 'Виробники товарів та їх доступність для вибору.',
    href: '/directories/brands',
    subject: 'inventory',
    icon: Package,
  },
  {
    title: 'Клієнти',
    description: 'Контакти, реквізити та історія звернень.',
    href: '/customers',
    subject: 'customers',
    icon: Users,
  },
  {
    title: 'Автомобілі',
    description: 'Дані автомобілів та історія обслуговування.',
    href: '/vehicles',
    subject: 'vehicles',
    icon: Car,
  },
  {
    title: 'Шаблони робіт',
    description: 'Типові роботи та набори позицій для нарядів.',
    href: '/labor-presets',
    subject: 'labor_presets',
    icon: Layers,
  },
  {
    title: 'Картки товарів',
    description: 'Назви, артикули, одиниці виміру та ціни товарів.',
    href: '/inventory',
    subject: 'inventory',
    icon: Package,
  },
]
export default async function Page() {
  const result = await withAuth(async ({ userId, isAdmin }) => {
    const member = await getCachedMembership(userId)
    return directories
      .filter(
        (d) =>
          isAdmin ||
          member?.customRole?.permissions.some(
            (p) => p.subject === d.subject && p.action === 'read'
          )
      )
      .map((d) => d.href)
  })
  if (!result.data) return <p role="alert">{result.error}</p>
  return (
    <>
      <PageHeader />
      <main className="overflow-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Довідники</h1>
          <p className="mt-2 text-muted-foreground">
            Оберіть довідник, щоб знайти, створити або відредагувати картку.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {directories
            .filter((d) => result.data?.includes(d.href))
            .map((d) => (
              <Link
                href={d.href}
                key={d.href}
                className="rounded-xl border-2 p-6 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-primary"
              >
                <d.icon className="mb-4 size-6 text-primary" />
                <h2 className="text-lg font-semibold">{d.title}</h2>
                <p className="mt-2 text-muted-foreground">{d.description}</p>
                <p className="mt-4 text-sm font-medium underline">Відкрити довідник →</p>
              </Link>
            ))}
        </div>
        {!result.data.length && (
          <p>Немає доступних довідників. Зверніться до адміністратора щодо прав доступу.</p>
        )}
      </main>
    </>
  )
}
