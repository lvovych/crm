'use server'

import { paymentTotal } from '@/features/finance/payment-total'
import { financeActive, lockFinance, postMoney } from '@/features/finance/ledger'
import {
  assertAccountAccess,
  assertFinancePermission,
  assertOperationDate,
} from '@/features/finance/access'
import { normalizeMoney } from '@/features/finance/money'
import { zonedDayKey } from '@/lib/timezone'
import { workshopTimeZone } from '@/lib/workshop-timezone'
import { toSafeWorkshopDate } from '@/lib/workshop-datetime'
import { db } from '@/lib/db'
import { issueInvoice, notifyInvoiceIssued } from '@/features/invoices/Lib/issueInvoice'
import { withAuth } from '@/lib/with-auth'
import { PermissionAction, PermissionSubject } from '@/lib/permissions'
import { createPaymentSchema } from '../Schema/paymentSchema'
import { revalidatePath } from 'next/cache'
import { getDocumentLockSettings } from '@/lib/document-lock.server'
import { DocumentLockedError, invoiceLockState } from '@/lib/document-lock'

export async function createPayment(input: unknown) {
  return withAuth(
    async (ctx) => {
      const { organizationId } = ctx
      const data = createPaymentSchema.parse(input)

      // Verify ownership: serviceRecord -> vehicle -> organizationId
      const serviceRecord = await db.serviceRecord.findFirst({
        where: { id: data.serviceRecordId, organizationId },
        select: { id: true, vehicleId: true },
      })
      if (!serviceRecord) throw new Error('Service record not found')

      const timeZone = await workshopTimeZone(organizationId)
      const write = {
        serviceRecordId: data.serviceRecordId,
        amount: data.amount,
        date: toSafeWorkshopDate(data.date, timeZone) ?? new Date(),
        method: data.method,
        note: data.note || null,
      }
      const { payment, issued } = await db.$transaction(async (tx) => {
        await lockFinance(tx, organizationId)
        const active = await financeActive(tx, organizationId)
        if (data.requestId) {
          const previous = await tx.payment.findUnique({
            where: {
              serviceRecordId_requestId: {
                serviceRecordId: data.serviceRecordId,
                requestId: data.requestId,
              },
            },
            include: { financialDocument: true },
          })
          if (previous && !previous.financialDocument) {
            if (
              previous.amount !== write.amount ||
              previous.method !== write.method ||
              previous.note !== write.note ||
              zonedDayKey(previous.date, timeZone) !== zonedDayKey(write.date, timeZone) ||
              Boolean(data.moneyAccountId)
            )
              throw new Error('Запит уже виконано з іншими даними.')
            return { payment: previous, issued: false }
          }
        }
        if (!active) {
          const payment = await tx.payment.create({ data: { ...write, requestId: data.requestId } })
          return {
            payment,
            issued: await issueInvoice(data.serviceRecordId, organizationId, 'paid', tx),
          }
        }
        await assertFinancePermission(ctx, PermissionAction.UPDATE)
        if (!data.moneyAccountId || !data.requestId)
          throw new Error('Оберіть касу та повторіть оплату.')
        const amount = normalizeMoney(data.amountExact ?? String(data.amount))
        if (Number(amount).toFixed(2) !== amount || Number(amount) !== data.amount)
          throw new Error('Сума оплати не відповідає точній сумі або перевищує допустиму точність.')
        const date = zonedDayKey(write.date, timeZone)
        await assertOperationDate(ctx, date)
        await assertAccountAccess(ctx, [data.moneyAccountId], tx)
        const old = await tx.financialDocument.findUnique({
          where: { organizationId_requestId: { organizationId, requestId: data.requestId } },
          include: { payment: true },
        })
        if (old) {
          if (
            old.payment?.serviceRecordId !== data.serviceRecordId ||
            old.amount.toFixed(2) !== amount ||
            old.targetAccountId !== data.moneyAccountId ||
            old.note !== (data.note || 'Оплата клієнта') ||
            old.date.toISOString().slice(0, 10) !== date ||
            old.payment.method !== data.method
          )
            throw new Error('Запит уже виконано з іншими даними.')
          return { payment: old.payment, issued: false }
        }
        const created = await tx.payment.create({
          data: {
            ...write,
            requestId: data.requestId,
            amount: Number(amount),
            amountExact: amount,
          },
        })
        await postMoney(tx, organizationId, ctx.userId, {
          requestId: data.requestId,
          kind: 'customer_payment',
          date,
          amount,
          targetAccountId: data.moneyAccountId,
          paymentId: created.id,
          note: data.note || 'Оплата клієнта',
        })
        return {
          payment: created,
          issued: await issueInvoice(data.serviceRecordId, organizationId, 'paid', tx),
        }
      })
      // Money against it makes the invoice the customer's document, even one
      // handed over on paper and never sent through the app.
      if (issued) notifyInvoiceIssued(data.serviceRecordId, organizationId)

      revalidatePath(
        serviceRecord.vehicleId
          ? `/vehicles/${serviceRecord.vehicleId}/service/${data.serviceRecordId}`
          : `/sales/${data.serviceRecordId}`
      )
      return {
        ...payment,
        amountExact: payment.amountExact?.toFixed(2) ?? null,
        serviceRecordId: data.serviceRecordId,
        amount: payment.amount,
        method: data.method,
      }
    },
    {
      requiredPermissions: [
        { action: PermissionAction.CREATE, subject: PermissionSubject.BILLING },
      ],
      audit: ({ result }) => ({
        action: 'payment.create',
        entity: 'Payment',
        entityId: result.id,
        details: {
          key: 'payment_create',
          params: { amount: result.amount, serviceRecordId: result.serviceRecordId },
        },
        metadata: {
          paymentId: result.id,
          serviceRecordId: result.serviceRecordId,
          amount: result.amount,
          method: result.method,
        },
      }),
    }
  )
}

export async function deletePayment(paymentId: string) {
  return withAuth(
    async ({ organizationId }) => {
      const { vehicleId, id: serviceId } = await db.$transaction(async (tx) => {
        await lockFinance(tx, organizationId)
        const payment = await tx.payment.findFirst({
          where: { id: paymentId, serviceRecord: { organizationId } },
          include: {
            serviceRecord: {
              select: {
                vehicleId: true,
                customerLedgerTracked: true,
                id: true,
                sentAt: true,
                manuallyPaid: true,
                totalAmount: true,
                cost: true,
                editUnlockedAt: true,
                payments: { select: { id: true, amount: true, amountExact: true } },
              },
            },
          },
        })
        if (!payment) throw new Error('Payment not found')

        // Recording payments is always allowed, but removing the payment that
        // settled a locked invoice would release the lock — the admin-only
        // unlock in disguise. Deleting a partial payment stays open to everyone,
        // since it never changes the lock.
        const settings = await getDocumentLockSettings(organizationId)
        const before = invoiceLockState(payment.serviceRecord, settings)
        const after = invoiceLockState(
          {
            ...payment.serviceRecord,
            payments: payment.serviceRecord.payments.filter((p) => p.id !== paymentId),
          },
          settings
        )
        if (before.locked && !after.locked && before.reason) {
          throw new DocumentLockedError(before.reason)
        }

        if (await tx.financialDocument.findFirst({ where: { organizationId, paymentId } }))
          throw new Error('Проведену оплату не можна видалити. Використайте сторно в розділі кас.')
        if (payment.serviceRecord.customerLedgerTracked) {
          // Stamp the deleting actor without changing financial data; the database
          // then appends the compensating event in the same transaction.
          await tx.payment.update({
            where: { id: paymentId },
            data: { ledgerActorId: null, ledgerActorName: null },
          })
        }
        await tx.payment.delete({ where: { id: paymentId } })

        return payment.serviceRecord
      })
      revalidatePath(
        vehicleId ? `/vehicles/${vehicleId}/service/${serviceId}` : `/sales/${serviceId}`
      )
      return { deleted: true, paymentId }
    },
    {
      requiredPermissions: [
        { action: PermissionAction.DELETE, subject: PermissionSubject.BILLING },
      ],
      audit: ({ result }) => ({
        action: 'payment.delete',
        entity: 'Payment',
        entityId: result.paymentId,
        details: { key: 'payment_delete', params: { id: result.paymentId } },
        metadata: { paymentId: result.paymentId },
      }),
    }
  )
}

/**
 * How much has been paid on one invoice, for the pay code dialog to watch
 * while a customer pays on their own phone. The payment is booked by the
 * vendor's webhook, not by this browser, so the page has to ask; asking for
 * one sum every few seconds is a great deal cheaper than re-rendering the
 * work order to find out.
 */
export async function getPaidTotal(serviceRecordId: string) {
  return withAuth(
    async ({ organizationId }) => {
      const record = await db.serviceRecord.findFirst({
        where: { id: serviceRecordId, organizationId },
        select: { manuallyPaid: true, payments: { select: { amount: true, amountExact: true } } },
      })
      if (!record) throw new Error('Service record not found')
      return {
        paid: Math.round(paymentTotal(record.payments) * 100) / 100,
        payments: record.payments.length,
        manuallyPaid: record.manuallyPaid,
      }
    },
    {
      requiredPermissions: [{ action: PermissionAction.READ, subject: PermissionSubject.SERVICES }],
    }
  )
}
