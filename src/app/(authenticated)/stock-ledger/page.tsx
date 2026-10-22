import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/page-header'
import { LedgerWorkspace } from '@/features/stock-ledger/Components/LedgerWorkspace'
export default function StockLedgerPage() {
 if(process.env.STOCK_LEDGER_ENABLED!=='true') notFound()
 return <><PageHeader/><section className="min-w-0 p-4 md:p-6"><LedgerWorkspace/></section></>
}
