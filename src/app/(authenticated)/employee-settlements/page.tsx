import SettlementView from '@/features/payroll/SettlementView'

export default function Page({ searchParams }: {
  searchParams: Promise<{ employee?: string; week?: string; pay?: string }>
}) {
  return <SettlementView searchParams={searchParams} />
}
