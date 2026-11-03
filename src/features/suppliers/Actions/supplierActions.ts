'use server'
import { assertSupplierDirectoryEnabled, supplierDirectoryEnabled } from '../Lib/enabled'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/with-auth'
import { PermissionAction as A, PermissionSubject as S } from '@/lib/permissions'
import { revalidatePath } from 'next/cache'
import { supplierSchema, supplierListSchema } from '../Schema/supplierSchema'
import { normalizeTaxId } from '../Lib/preview'
const permission = (action: A) => [{ action, subject: S.SUPPLIERS }]
export async function listSuppliers(input: unknown = {}) {
  return withAuth(
    async ({ organizationId }) => {
      assertSupplierDirectoryEnabled(organizationId)
      const p = supplierListSchema.parse(input)
      const where = {
        organizationId,
        supplierProfile: { isNot: null },
        ...(p.archived === 'all' ? {} : { isArchived: p.archived === 'archived' }),
        ...(p.source === 'carbook'
          ? { sourceLinks: { some: { source: 'carbook' } } }
          : p.source === 'manual'
            ? { sourceLinks: { none: {} } }
            : {}),
        ...(p.search
          ? {
              OR: [
                { name: { contains: p.search, mode: 'insensitive' as const } },
                { legalName: { contains: p.search, mode: 'insensitive' as const } },
                ...(normalizeTaxId(p.search)
                  ? [{ taxId: { contains: normalizeTaxId(p.search) } }]
                  : []),
                {
                  contacts: {
                    some: {
                      OR: [
                        { phone: { contains: p.search } },
                        { email: { contains: p.search, mode: 'insensitive' as const } },
                      ],
                    },
                  },
                },
              ],
            }
          : {}),
      }
      const [items, total] = await Promise.all([
        db.counterparty.findMany({
          where,
          include: { supplierProfile: true, contacts: true, sourceLinks: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          take: 25,
          skip: (p.page - 1) * 25,
        }),
        db.counterparty.count({ where }),
      ])
      return { items, total, page: p.page }
    },
    { requiredPermissions: permission(A.READ) }
  )
}
export async function getSupplier(id: string) {
  return withAuth(
    async ({ organizationId }) => {
      assertSupplierDirectoryEnabled(organizationId)
      const supplier = await db.counterparty.findFirst({
        where: { id, organizationId, supplierProfile: { isNot: null } },
        include: {
          supplierProfile: true,
          contacts: true,
          bankAccounts: true,
          sourceLinks: true,
          preferredParts: {
            select: { id: true, name: true, partNumber: true },
            take: 100,
            orderBy: { name: 'asc' },
          },
        },
      })
      if (!supplier) throw new Error('Supplier not found')
      const history = await db.auditLog.findMany({
        where: { organizationId, entity: 'Counterparty', entityId: id },
        orderBy: { timestamp: 'desc' },
        take: 50,
      })
      return { supplier, history }
    },
    { requiredPermissions: permission(A.READ) }
  )
}
export async function saveSupplier(input: unknown, id?: string, expectedUpdatedAt?: string) {
  return withAuth(
    async ({ organizationId, userId }) => {
      assertSupplierDirectoryEnabled(organizationId)
      const parsed = supplierSchema.parse(input)
      const { contacts, bankAccounts, paymentTermDays, paymentTerms, ...fields } = parsed
      const result = await db.$transaction(async (tx) => {
        const data = { ...fields, taxId: normalizeTaxId(fields.taxId) || null }
        let counterpartyId: string
        if (id) {
          if (!expectedUpdatedAt || !Number.isFinite(Date.parse(expectedUpdatedAt)))
            throw new Error('Reload supplier before editing')
          const updated = await tx.counterparty.updateMany({
            where: { id, organizationId, updatedAt: new Date(expectedUpdatedAt) },
            data,
          })
          if (updated.count !== 1)
            throw new Error('Supplier changed or is unavailable. Reload and try again.')
          counterpartyId = id
          await tx.counterpartyContact.deleteMany({ where: { organizationId, counterpartyId } })
          await tx.counterpartyBankAccount.deleteMany({ where: { organizationId, counterpartyId } })
        } else {
          counterpartyId = (
            await tx.counterparty.create({ data: { ...data, organizationId, createdById: userId } })
          ).id
        }
        await tx.supplierProfile.upsert({
          where: { counterpartyId },
          create: {
            organizationId,
            counterpartyId,
            paymentTermDays,
            paymentTerms,
          },
          update: { paymentTermDays, paymentTerms },
        })
        if (contacts.length)
          await tx.counterpartyContact.createMany({
            data: contacts.map((c) => ({ ...c, organizationId, counterpartyId })),
          })
        if (bankAccounts.length)
          await tx.counterpartyBankAccount.createMany({
            data: bankAccounts.map((c) => ({ ...c, organizationId, counterpartyId })),
          })
        return { id: counterpartyId }
      })
      revalidatePath('/suppliers')
      revalidatePath('/suppliers/' + result.id)
      return result
    },
    {
      requiredPermissions: permission(id ? A.UPDATE : A.CREATE),
      audit: ({ result }) => ({
        action: id ? 'supplier.update' : 'supplier.create',
        entity: 'Counterparty',
        entityId: result.id,
      }),
    }
  )
}
export async function archiveSupplier(id: string, archived: boolean) {
  return withAuth(
    async ({ organizationId }) => {
      assertSupplierDirectoryEnabled(organizationId)
      if (typeof archived !== 'boolean') throw new Error('Invalid archive state')
      const result = await db.counterparty.updateMany({
        where: { id, organizationId, supplierProfile: { isNot: null } },
        data: { isArchived: archived },
      })
      if (result.count !== 1) throw new Error('Supplier not found')
      revalidatePath('/suppliers')
      revalidatePath('/suppliers/' + id)
      return { id, archived }
    },
    {
      requiredPermissions: permission(A.DELETE),
      audit: ({ result }) => ({
        action: result.archived ? 'supplier.archive' : 'supplier.restore',
        entity: 'Counterparty',
        entityId: result.id,
      }),
    }
  )
}

export async function getSupplierCapabilities() {
  return withAuth(
    async ({ organizationId, userId, isAdmin }) => {
      assertSupplierDirectoryEnabled(organizationId)
      const member = await db.organizationMember.findUnique({
        where: { userId_organizationId: { userId, organizationId } },
        include: { customRole: { include: { permissions: true } } },
      })
      const can = (action: A) =>
        isAdmin ||
        !!member?.customRole?.permissions.some(
          (p) => p.subject === S.SUPPLIERS && p.action === action
        )
      return {
        create: can(A.CREATE),
        update: can(A.UPDATE),
        archive: can(A.DELETE),
        import: can(A.MANAGE),
      }
    },
    { requiredPermissions: permission(A.READ) }
  )
}

export async function supplierDirectoryAvailable() {
  return withAuth(async ({ organizationId }) => supplierDirectoryEnabled(organizationId))
}
