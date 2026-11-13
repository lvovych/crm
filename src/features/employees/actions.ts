'use server'

import { staffCan } from './access'
import { workshopTimeZone } from '@/lib/workshop-timezone'
import { zonedDayKey } from '@/lib/timezone'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { PermissionAction as A, PermissionSubject as S } from '@/lib/permissions'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

export async function directory() {
  return withAuth(
    async (ctx) => ({
      people: await db.technician.findMany({
        where: { organizationId: ctx.organizationId },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, workRoles: true, givenName: true, familyName: true, hiredOn: true, dismissedOn: true, userId: true },
      }),
      canManage: await staffCan(ctx, { subject: S.EMPLOYEES, action: A.MANAGE }),
      canSeePayroll: await staffCan(ctx, { subject: S.PAYROLL, action: A.READ }),
    }),
    { requiredPermissions: [{ subject: S.EMPLOYEES, action: A.READ }] }
  )
}

export async function saveEmployee(form: FormData) {
  const result = await withAuth(
    async ({ organizationId }) => {
      const id = String(form.get('id') || '')
      const profile = form.has('givenName')
      const givenName = profile ? z.string().trim().min(1).max(160).parse(form.get('givenName')) : undefined
      const familyName = profile ? z.string().trim().max(160).parse(form.get('familyName')) : undefined
      const name = z.string().trim().min(1).max(160).parse(profile ? [givenName, familyName].filter(Boolean).join(' ') : form.get('name'))
      const date = (key: string) => form.get(key) ? new Date(z.string().date().parse(form.get(key))) : null
      const hiredOn = date('hiredOn')
      const dismissedOn = date('dismissedOn')
      if (dismissedOn && hiredOn && dismissedOn < hiredOn) throw new Error('Дата звільнення передує даті прийому.')
      if (dismissedOn && dismissedOn.toISOString().slice(0, 10) > zonedDayKey(new Date(), await workshopTimeZone(organizationId)))
        throw new Error('Дата фактичного звільнення не може бути в майбутньому.')
      const dates = profile ? { hiredOn, dismissedOn } : {}
      const workRoles = z
        .array(z.enum(['mechanic', 'parts', 'advisor', 'owner']))
        .min(1)
        .parse(form.getAll('roles'))
      if (id) {
        const previous = await db.technician.findFirstOrThrow({ where: { id, organizationId }, select: { dismissedOn: true } })
        const activity = profile && (dismissedOn || previous.dismissedOn) ? { isActive: !dismissedOn } : {}
        await db.technician.update({
          where: { id, organizationId },
          data: { name, workRoles, givenName, familyName, ...dates, ...activity },
        })
      } else {
        await db.technician.create({ data: { organizationId, name, workRoles } })
      }
    },
    { requiredPermissions: [{ subject: S.EMPLOYEES, action: A.MANAGE }] }
  )
  if (!result.success) throw new Error(result.error)
  revalidatePath('/employees')
  revalidatePath('/employees/[id]', 'page')
}

export async function dismissEmployee(form: FormData) {
  const result = await withAuth(
    async ({ organizationId }) => {
      await db.technician.update({
        where: { id: String(form.get('id')), organizationId, dismissedOn: null },
        data: { dismissedOn: new Date(), isActive: false },
      })
    },
    { requiredPermissions: [{ subject: S.EMPLOYEES, action: A.MANAGE }] }
  )
  if (!result.success) throw new Error(result.error)
  revalidatePath('/employees')
}

export async function linkEmployee(form: FormData) {
  const result = await withAuth(
    async ({ organizationId }) => {
      const userId = String(form.get('userId'))
      const id = String(form.get('employee') || '')
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}),hashtext('employee-link'))`
        await tx.organizationMember.findFirstOrThrow({ where: { organizationId, userId } })
        await tx.technician.updateMany({
          where: { organizationId, userId },
          data: { userId: null },
        })
        if (id)
          await tx.technician.update({
            where: { id, organizationId, dismissedOn: null, userId: null },
            data: { userId },
          })
      })
    },
    { requiredPermissions: [{ subject: S.SETTINGS, action: A.MANAGE }] }
  )
  if (!result.success) throw new Error(result.error)
  revalidatePath('/settings/team')
}
export async function memberLinks() {
  return withAuth(
    async ({ organizationId }) => ({
      members: await db.organizationMember.findMany({
        where: { organizationId },
        select: { user: { select: { id: true, name: true, email: true } } },
      }),
      employees: await db.technician.findMany({
        where: { organizationId, dismissedOn: null },
        select: { id: true, name: true, userId: true },
        orderBy: { name: 'asc' },
      }),
    }),
    { requiredPermissions: [{ subject: S.SETTINGS, action: A.MANAGE }] }
  )
}
