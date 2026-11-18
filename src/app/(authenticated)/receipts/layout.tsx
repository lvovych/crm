import { PageHeader } from '@/components/page-header'
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader />
      <main className="ops-workspace mx-auto w-full max-w-[1440px] space-y-6 overflow-auto p-4 sm:p-6">
        {children}
      </main>
    </>
  )
}
