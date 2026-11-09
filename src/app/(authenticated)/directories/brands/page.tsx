import Link from 'next/link'
import { PageHeader } from '@/components/page-header'
import { brandDirectory } from '@/features/inventory/Actions/manageBrands'
import { BrandDirectory } from '@/features/inventory/Components/BrandDirectory'
export default async function Page() {
  const result = await brandDirectory()
  if (!result.data) return <p role="alert">{result.error}</p>
  return (
    <>
      <PageHeader />
      <main className="overflow-auto p-6 space-y-5">
        <Link className="underline" href="/directories">
          Довідники
        </Link>
        <h1 className="text-2xl font-semibold">Бренди</h1>
        <BrandDirectory {...result.data} />
      </main>
    </>
  )
}
