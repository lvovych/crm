import Link from 'next/link'
import { PageHeader } from '@/components/page-header'
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader />
      <main className="space-y-5 overflow-auto p-6">
        <Link className="text-sm underline" href="/receipts">
          Журнал надходжень
        </Link>
        {children}
      </main>
    </>
  )
}
