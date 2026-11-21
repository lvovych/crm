'use server'

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import type { PaySlip } from '@/generated/prisma/client'
import type { TxClient } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { staffCan } from '@/features/employees/access'
import { rosterIdentity, rosterUser } from '@/features/employees/roster'
import { PermissionAction as A, PermissionSubject as S } from '@/lib/permissions'
import { workshopTimeZone } from '@/lib/workshop-timezone'
import { fingerprint, lockFinance } from '@/features/finance/ledger'
import { allocatePayments } from './allocation'
import { calculateDocument } from './document-calculation'
import { legacyRules, serializeRule, rulesAt, ruleSchema } from './commission-rules'
import type { CommissionDetails } from './commission-calculator'

const read = { requiredPermissions: [{ action: A.READ, subject: S.PAYROLL }] }
const manage = { requiredPermissions: [{ action: A.MANAGE, subject: S.PAYROLL }] }
const periodSchema = z
  .object({ employee: z.string().min(1), start: z.string().date(), end: z.string().date() })
  .refine((p) => p.start <= p.end, 'Кінець періоду має бути не раніше початку.')
function documentRevision(
  d: Pick<PaySlip, 'technicianId' | 'start' | 'end' | 'documentDate' | 'total' | 'lines'>
) {
  return fingerprint({
    employee: d.technicianId,
    start: d.start.toISOString(),
    end: d.end.toISOString(),
    date: d.documentDate.toISOString(),
    total: d.total.toFixed(2),
    lines: d.lines,
  })
}
function refresh() {
  for (const path of ['/payroll', '/employees', '/employee-settlements']) revalidatePath(path)
  revalidatePath('/employees/[id]', 'page')
}
export async function payrollWorkspace(documentId?: string) {
  return withAuth(async (ctx) => {
    const people = await db.technician.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: { payPlans: true, payRuleVersions: true, user: rosterUser },
    })
    const documents = await db.paySlip.findMany({
      where: { technician: { organizationId: ctx.organizationId } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
    })
    if (documentId && !documents.some((d) => d.id === documentId)) {
      const older = await db.paySlip.findFirst({
        where: { id: documentId, technician: { organizationId: ctx.organizationId } },
      })
      if (older) documents.unshift(older)
    }
    return {
      canManage: await staffCan(ctx, { action: A.MANAGE, subject: S.PAYROLL }),
      zone: await workshopTimeZone(ctx.organizationId),
      people: people.map((p) => ({
        id: p.id,
        name: rosterIdentity(p).name,
        roles: rosterIdentity(p).workRoles,
        crmRole: rosterIdentity(p).crmRole,
        active: p.isActive && !p.dismissedOn,
        dismissed: !!p.dismissedOn,
        legacySalary: p.payPlans.some((plan) => plan.monthly.gt(0)),
        rules: [...legacyRules(p.payPlans), ...p.payRuleVersions.map(serializeRule)],
      })),
      documents: documents.map((d) => ({
        id: d.id,
        employee: d.technicianId,
        start: d.start.toISOString().slice(0, 10),
        end: d.end.toISOString().slice(0, 10),
        date: d.documentDate.toISOString().slice(0, 10),
        status: d.status,
        total: d.total.toFixed(2),
        details: d.lines,
        revision: documentRevision(d),
        createdAt: d.createdAt.toISOString(),
      })),
    }
  }, read)
}
export async function previewDocument(input: unknown) {
  return withAuth(async ({ organizationId }) => {
    const p = periodSchema.parse(input)
    const details = await db.$transaction(async (tx) => {
      await lockFinance(tx, organizationId)
      return calculateDocument(
        tx,
        organizationId,
        p.employee,
        new Date(p.start),
        new Date(p.end),
        await workshopTimeZone(organizationId)
      )
    })
    return { details, fingerprint: fingerprint(details) }
  }, read)
}

async function noOverlap(tx: TxClient, employee: string, start: Date, end: Date, id: string) {
  if (
    await tx.paySlip.findFirst({
      where: { technicianId: employee, id: { not: id }, start: { lte: end }, end: { gte: start } },
    })
  )
    throw new Error(
      'За цей період уже є документ або чернетка. Відкрийте його, щоб уникнути повторного нарахування.'
    )
}
async function noRepeatedOrders(
  tx: TxClient,
  employee: string,
  id: string,
  details: CommissionDetails
) {
  const posted = await tx.paySlip.findMany({
    where: { technicianId: employee, status: 'completed', id: { not: id } },
    select: { lines: true },
  })
  const keys = new Set(details.lines.map((l) => l.orderId)),
    labels = new Set(details.lines.map((l) => l.order))
  for (const d of posted) {
    const payload = d.lines as unknown as { lines?: { orderId?: string; order?: string }[] }
    const lines = Array.isArray(payload) ? payload : (payload?.lines ?? [])
    if (lines.some((l) => (l.orderId ? keys.has(l.orderId) : !!l.order && labels.has(l.order))))
      throw new Error(
        'Один із нарядів уже врахований у проведеній зарплаті цього працівника. Потрібне окреме коригування, а не повторне нарахування.'
      )
  }
}
export async function saveSalaryDocument(input: unknown) {
  return withAuth(async ({ organizationId, userId }) => {
    const p = periodSchema
      .and(
        z.object({
          id: z.string().min(1),
          date: z.string().date(),
          preview: z.string(),
          existing: z.boolean(),
          revision: z.string().optional(),
        })
      )
      .parse(input)
    const zone = await workshopTimeZone(organizationId)
    const saved = await db.$transaction(async (tx) => {
      await lockFinance(tx, organizationId)
      const current = await tx.paySlip.findFirst({
        where: { id: p.id, technician: { organizationId } },
      })
      if (p.existing) {
        if (!current || current.status !== 'new')
          throw new Error('Документ не знайдено або вже проведено.')
        if (p.revision !== documentRevision(current))
          throw new Error('Чернетку змінено в іншій вкладці. Оновіть документ.')
      } else if (current) {
        if (
          current.technicianId === p.employee &&
          current.start.toISOString().slice(0, 10) === p.start &&
          current.end.toISOString().slice(0, 10) === p.end &&
          current.documentDate.toISOString().slice(0, 10) === p.date &&
          fingerprint(current.lines) === p.preview
        )
          return { id: current.id, revision: documentRevision(current) }
        throw new Error('Такий документ уже існує. Оновіть сторінку.')
      }
      const start = new Date(p.start),
        end = new Date(p.end)
      await noOverlap(tx, p.employee, start, end, p.id)
      const details = await calculateDocument(tx, organizationId, p.employee, start, end, zone)
      if (fingerprint(details) !== p.preview)
        throw new Error('Дані або правила змінилися. Повторіть попередній розрахунок.')
      if (!details.lines.length)
        throw new Error(
          'Немає нарахувань: перевірте закриті наряди, призначення та правила за період.'
        )
      await noRepeatedOrders(tx, p.employee, p.id, details)
      const data = {
        technicianId: p.employee,
        start,
        end,
        documentDate: new Date(p.date),
        total: details.total,
        lines: details,
        actorId: userId,
      }
      const document = current
        ? await tx.paySlip.update({ where: { id: p.id }, data })
        : await tx.paySlip.create({ data: { ...data, id: p.id, status: 'new' } })
      return { id: p.id, revision: documentRevision(document) }
    })
    refresh()
    return saved
  }, manage)
}
export async function postSalaryDocument(input: unknown) {
  return withAuth(async ({ organizationId }) => {
    const p = z.object({ id: z.string().min(1), revision: z.string() }).parse(input)
    const zone = await workshopTimeZone(organizationId)
    await db.$transaction(async (tx) => {
      await lockFinance(tx, organizationId)
      const slip = await tx.paySlip.findFirstOrThrow({
        where: { id: p.id, technician: { organizationId } },
      })
      if (slip.status === 'completed') return
      if (documentRevision(slip) !== p.revision)
        throw new Error('Документ змінився. Оновіть сторінку.')
      // Stabilize closure status and totals while verifying and posting.
      await tx.$queryRaw`SELECT id FROM service_records WHERE "organizationId" = ${organizationId} AND status = 'completed' FOR SHARE`
      const details = await calculateDocument(
        tx,
        organizationId,
        slip.technicianId,
        slip.start,
        slip.end,
        zone
      )
      if (
        !details.lines.length ||
        slip.total.toFixed(2) !== details.total ||
        fingerprint(details) !== fingerprint(slip.lines)
      )
        throw new Error(
          'Наряди або правила змінилися. Перерахуйте чернетку і перевірте суми перед проведенням.'
        )
      await noOverlap(tx, slip.technicianId, slip.start, slip.end, slip.id)
      await noRepeatedOrders(tx, slip.technicianId, slip.id, details)
      await tx.paySlip.update({ where: { id: slip.id }, data: { status: 'completed' } })
      await allocatePayments(tx, slip.technicianId)
    })
    refresh()
    return { id: p.id }
  }, manage)
}
export async function saveCommissionRule(input: unknown) {
  return withAuth(async ({ organizationId, userId }) => {
    const envelope = z
      .object({
        employee: z.string().min(1),
        ruleKey: z.string().optional(),
        previous: z.string().optional(),
        allowOverlap: z.boolean().default(false),
        rule: ruleSchema,
      })
      .parse(input)
    await db.$transaction(async (tx) => {
      await lockFinance(tx, organizationId)
      const person = await tx.technician.findFirstOrThrow({
        where: { id: envelope.employee, organizationId },
        include: { payPlans: true, payRuleVersions: true },
      })
      const versions = [
        ...legacyRules(person.payPlans),
        ...person.payRuleVersions.map(serializeRule),
      ]
      if (envelope.ruleKey) {
        const history = versions
          .filter((r) => r.ruleKey === envelope.ruleKey)
          .sort(
            (a, b) =>
              b.createdAt.localeCompare(a.createdAt) ||
              b.effective.localeCompare(a.effective) ||
              b.id.localeCompare(a.id)
          )
        if (!history.length || history[0].id !== envelope.previous)
          throw new Error('Правило змінилося. Оновіть налаштування.')
      }
      const r = envelope.rule
      const category = (basis: string) =>
        basis === 'orderMargin'
          ? ['parts', 'labor']
          : [basis === 'labor' || basis === 'managerLabor' ? 'labor' : 'parts']
      const dates = new Set([
        r.effective,
        ...versions.filter((v) => v.effective >= r.effective).map((v) => v.effective),
      ])
      const overlapping = [...dates].some((day) =>
        rulesAt(versions, day).some(
          (other) =>
            other.ruleKey !== envelope.ruleKey &&
            category(other.basis).some((k) => category(r.basis).includes(k))
        )
      )
      if (r.enabled && overlapping && !envelope.allowOverlap)
        throw new Error(
          'Бази правил перетинаються. Підтвердьте нарахування за обома правилами або змініть базу.'
        )
      await tx.employeePayRule.create({
        data: {
          ...r,
          effective: new Date(r.effective),
          technicianId: person.id,
          ruleKey: envelope.ruleKey || randomUUID(),
          actorId: userId,
          createdAt: new Date(
            Math.max(Date.now(), ...versions.map((v) => new Date(v.createdAt).getTime() + 1))
          ),
        },
      })
    })
    refresh()
    return { saved: true }
  }, manage)
}
