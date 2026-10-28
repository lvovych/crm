import { readLedgerCustomerTotals } from '@/features/stock-ledger/Lib/customerReadModel'
import { D } from '@/features/stock-ledger/Lib/amounts'
import { NextResponse } from 'next/server'
import { workshopCurrencySettings } from '@/lib/workshop-currency'
import { z } from 'zod'
import { db } from '@/lib/db'
import {
  PAYMENT_CONNECTOR_IDS,
  isOffered,
  paymentProviderFor,
} from '@/features/integrations/Lib/payments'
import { writeLog } from '@/features/integrations/Lib/connections'
import { rateLimit } from '@/lib/rate-limit'
import { resolvePortalOrg } from '@/lib/portal-slug'
import { calculateTotals, discountAmountFor } from '@/lib/tax'
import { getFeatures } from '@/lib/features'

const checkoutSchema = z.object({
  provider: z.enum(PAYMENT_CONNECTOR_IDS as [string, ...string[]]),
  amount: z.number().positive(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string; token: string }> }
) {
  const limited = rateLimit(request, { limit: 10, windowMs: 60_000, anonymous: true })
  if (limited) return limited

  try {
    const { orgId: orgParam, token } = await params

    // Resolve slug (e.g. "egelandauto") or UUID to the real org ID
    const resolvedOrg = await resolvePortalOrg(orgParam)
    const orgId = resolvedOrg?.id ?? orgParam

    const record = await db.serviceRecord.findUnique({
      where: { publicToken: token },
      include: {
        payments: true,
        partItems: true,
        laborItems: true,
        vehicle: {
          select: { organizationId: true },
        },
      },
    })

    if (!record || record.organizationId !== orgId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    // A connected provider outlives a downgrade; the plan decides, not the row.
    const features = await getFeatures(orgId)
    if (!features.payments) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const body = await request.json()
    const parsed = checkoutSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { provider, amount } = parsed.data

    // Calculate balance due — mirrors invoice-view.tsx so the server's
    // notion of total matches what the customer sees on the share page.
    const partsSubtotal = record.partItems.reduce((sum, p) => sum + p.total, 0)
    const laborSubtotal = record.laborItems.reduce((sum, l) => sum + l.total, 0)
    const computedSubtotal = partsSubtotal + laborSubtotal
    const computedDiscount = discountAmountFor(
      computedSubtotal,
      record.discountType,
      record.discountValue
    )
    const { totalAmount: computedTotal } = calculateTotals({
      subtotal: computedSubtotal,
      discountAmount: computedDiscount,
      taxRate: record.taxRate,
      taxInclusive: record.taxInclusive ?? false,
    })
    const displayTotal =
      record.totalAmount > 0 ? record.totalAmount : computedTotal > 0 ? computedTotal : record.cost
    const paidFromPayments = record.payments.reduce((sum, p) => sum + p.amount, 0)
    const totalPaid = record.manuallyPaid ? displayTotal : paidFromPayments
    const ledgerBalance =
      record.financeAccountingMode === 'LEDGER'
        ? (
            await readLedgerCustomerTotals(
              db as unknown as import('@/features/stock-ledger/Lib/transaction').LedgerDB,
              orgId,
              [record.id]
            )
          ).get(record.id)
        : undefined
    if (record.financeAccountingMode === 'LEDGER' && !ledgerBalance)
      return NextResponse.json({ error: 'Invoice has not been issued yet' }, { status: 409 })
    const balanceDue = ledgerBalance ? Number(ledgerBalance.debt) : displayTotal - totalPaid

    if (balanceDue <= 0) {
      return NextResponse.json({ error: 'Invoice is already paid in full' }, { status: 400 })
    }

    if (
      amount < 0.01 ||
      (ledgerBalance
        ? D(String(amount)).decimalPlaces() > 2 || D(String(amount)).gt(ledgerBalance.debt)
        : amount > balanceDue + 0.01)
    ) {
      return NextResponse.json(
        { error: `Amount must be between 0.01 and ${balanceDue.toFixed(2)}` },
        { status: 400 }
      )
    }

    // The vendor's connection, adopted from the old settings rows on the
    // first checkout after the move. A vendor the workshop has paused with
    // the offered switch takes no new payments, whatever the page showed.
    const connected = await paymentProviderFor(orgId, provider)
    if (!connected || !isOffered(connected.setup)) {
      return NextResponse.json(
        { error: `Payment provider "${provider}" is not enabled` },
        { status: 400 }
      )
    }

    const { currencyCode } = await workshopCurrencySettings(orgId)
    const invoiceNumber = record.invoiceNumber || `INV-${record.id.slice(-8).toUpperCase()}`

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
    const invoiceUrl = `${appUrl}/share/invoice/${orgId}/${token}`

    try {
      const result = await connected.provider.createCheckout({
        amount,
        currency: currencyCode,
        invoiceNumber,
        description: `Payment for ${invoiceNumber} - ${record.title}`,
        successUrl: invoiceUrl,
        cancelUrl: invoiceUrl,
        serviceRecordId: record.id,
        orgId,
      })
      return NextResponse.json(result)
    } catch (error) {
      // The vendor's answer is for the workshop, on the connection's
      // activity log, where whoever set the keys up will look. The customer
      // is told only that it did not work.
      const message = error instanceof Error ? error.message : String(error)
      console.error('[Checkout] Error:', error)
      await writeLog(connected.setup.connectionId, 'error', `Checkout failed: ${message}`, {
        invoiceNumber,
        amount,
        currency: currencyCode,
      })
      return NextResponse.json({ error: 'Checkout failed' }, { status: 500 })
    }
  } catch (error) {
    console.error('[Checkout] Error:', error)
    return NextResponse.json({ error: 'Checkout failed' }, { status: 500 })
  }
}
