import { PageHeader } from '@/components/page-header'
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader />
      <main className="ops-workspace mx-auto w-full max-w-[1440px] space-y-6 p-4 pb-32 sm:p-6 sm:pb-32">
        {children}
      </main>
    </>
  )
}
