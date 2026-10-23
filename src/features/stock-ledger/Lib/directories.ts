import { z } from 'zod'
import { supplierSchema, warehouseSchema, accountSchema } from './contracts'
import { ledgerCommand, type LedgerDB, type LedgerContext } from './transaction'
const revision = {
  id: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  archived: z.boolean().default(false),
}
export function directoryOperations(db: LedgerDB, ctx: LedgerContext) {
  const org = { organizationId: ctx.organizationId }
  return {
    async supplier(raw: unknown) {
      const input = supplierSchema.extend(revision).parse(raw)
      return ledgerCommand(db, ctx, 'supplier.update', input, async (tx) => {
        const old = await tx.supplier.findFirst({
          where: { ...org, id: input.id, version: input.expectedVersion },
        })
        if (!old) throw new Error('Запис змінено іншим користувачем. Оновіть довідник.')
        if (
          input.archived &&
          ((await tx.purchaseOrder.count({
            where: {
              ...org,
              supplierId: old.id,
              status: { in: ['DRAFT', 'CONFIRMED', 'PARTIALLY_RECEIVED'] },
            },
          })) ||
            (await tx.inventoryDocument.count({
              where: { ...org, supplierId: old.id, status: 'DRAFT' },
            })))
        )
          throw new Error('Спочатку завершіть закупівлі та чернетки приходу постачальника')
        const { id, expectedVersion, idempotencyKey, archived, ...data } = input
        await tx.supplier.update({
          where: { id },
          data: {
            ...data,
            taxId: data.taxId || null,
            normalizedName: data.name.normalize('NFKC').toLocaleLowerCase('uk'),
            archivedAt: archived ? (old.archivedAt ?? new Date()) : null,
            version: { increment: 1 },
          },
        })
        await tx.settlementParty.updateMany({
          where: { ...org, supplierId: id },
          data: { displayNameSnapshot: data.name },
        })
        return { id, version: old.version + 1 }
      })
    },
    async warehouse(raw: unknown) {
      const input = warehouseSchema
        .extend({ ...revision, isDefault: z.boolean().default(false) })
        .parse(raw)
      return ledgerCommand(db, ctx, 'warehouse.update', input, async (tx) => {
        const old = await tx.warehouse.findFirst({
          where: { ...org, id: input.id, version: input.expectedVersion },
        })
        if (!old) throw new Error('Запис змінено іншим користувачем. Оновіть довідник.')
        if (input.archived) {
          if (old.isDefault || input.isDefault)
            throw new Error('Спочатку виберіть інший склад за замовчуванням')
          if (
            await tx.stockLotBalance.count({
              where: {
                ...org,
                warehouseId: old.id,
                OR: [{ onHandQty: { not: 0 } }, { reservedQty: { not: 0 } }],
              },
            })
          )
            throw new Error('Склад має залишки або резерви')
          if (
            (await tx.purchaseOrder.count({
              where: {
                ...org,
                warehouseId: old.id,
                status: { in: ['DRAFT', 'CONFIRMED', 'PARTIALLY_RECEIVED'] },
              },
            })) ||
            (await tx.inventoryDocument.count({
              where: {
                ...org,
                status: 'DRAFT',
                OR: [{ sourceWarehouseId: old.id }, { targetWarehouseId: old.id }],
              },
            }))
          )
            throw new Error('Склад використовується у відкритих документах')
        }
        if (
          !input.reservable &&
          (await tx.stockLotBalance.count({
            where: { ...org, warehouseId: old.id, reservedQty: { gt: 0 } },
          }))
        )
          throw new Error('Спочатку звільніть резерви складу')
        if (input.isDefault)
          await tx.warehouse.updateMany({
            where: { ...org, id: { not: old.id }, isDefault: true },
            data: { isDefault: false, version: { increment: 1 } },
          })
        const { id, expectedVersion, idempotencyKey, archived, ...data } = input
        if (old.isDefault && !data.isDefault)
          throw new Error('Призначте інший склад за замовчуванням через його картку')
        await tx.warehouse.update({
          where: { id },
          data: {
            ...data,
            archivedAt: archived ? (old.archivedAt ?? new Date()) : null,
            version: { increment: 1 },
          },
        })
        return { id, version: old.version + 1 }
      })
    },
    async account(raw: unknown) {
      const input = accountSchema.extend(revision).parse(raw)
      return ledgerCommand(db, ctx, 'account.update', input, async (tx) => {
        const old = await tx.cashAccount.findFirst({
          where: { ...org, id: input.id, version: input.expectedVersion },
        })
        if (!old) throw new Error('Запис змінено іншим користувачем. Оновіть довідник.')
        if (
          input.kind !== old.kind &&
          (await tx.cashLedgerEntry.count({ where: { ...org, accountId: old.id } }))
        )
          throw new Error('Вид рахунку з історією рухів змінювати не можна')
        if (input.archived) {
          const balance = await tx.cashLedgerEntry.aggregate({
            where: { ...org, accountId: old.id },
            _sum: { amountDelta: true },
          })
          if (balance._sum.amountDelta && !balance._sum.amountDelta.isZero())
            throw new Error('Перед архівуванням баланс рахунку має бути нульовим')
        }
        await tx.cashAccount.update({
          where: { id: old.id },
          data: {
            name: input.name,
            kind: input.kind,
            archivedAt: input.archived ? (old.archivedAt ?? new Date()) : null,
            version: { increment: 1 },
          },
        })
        return { id: old.id, version: old.version + 1 }
      })
    },
  }
}
