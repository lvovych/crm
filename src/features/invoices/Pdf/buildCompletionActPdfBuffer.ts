import 'server-only'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import '@/features/vehicles/Components/invoice-pdf/fonts'
import { assembleInvoicePrint } from '../Lib/assembleInvoicePrint'
import { renderCompletionAct } from './completion-act/renderCompletionAct'

/** An act is a separate live document, without issuing or changing the invoice. */
export async function buildCompletionActPdfBuffer(recordId: string) {
  const a = await assembleInvoicePrint(recordId, { mode: 'live' })
  if (!a) return null
  const settings = a.settingsMap
  const buffer = await renderCompletionAct({
    data: a.data,
    provider: {
      name: settings['completionAct.providerName'] || a.workshop.name,
      address: settings['completionAct.providerAddress'] || a.workshop.address,
      phone: settings['completionAct.providerPhone'] || a.workshop.phone,
      code: settings['completionAct.providerCode'] || a.invoiceSettings.orgNumber || '',
      bank: settings['completionAct.providerBank'] || a.invoiceSettings.bankAccount || '',
    },
    logoDataUri:
      a.logoDataUri ||
      `data:image/png;base64,${(await readFile(path.join(process.cwd(), 'public/lauto-act-logo.png'))).toString('base64')}`,
    currency: a.invoiceSettings.currencyCode || 'UAH',
    timezone: a.invoiceSettings.timezone || 'Europe/Kyiv',
  })
  return { buffer, filename: `completion-act-${recordId.replace(/[^a-zA-Z0-9_-]/g, '')}.pdf` }
}
