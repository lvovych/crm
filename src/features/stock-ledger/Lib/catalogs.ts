import { z } from 'zod'
import { commandSchema } from './contracts'
import { D, decimalText } from './amounts'
import { ledgerCommand, metadata, type LedgerContext, type LedgerDB, type Tx } from './transaction'
const counts = new Set(['pcs', 'шт', 'шт.', 'stk', 'vnt.', 'set', 'компл', 'компл.', 'уп', 'уп.'])
const measures = new Set([
  'l',
  'л',
  'ml',
  'мл',
  'kg',
  'кг',
  'g',
  'г',
  'm',
  'м',
  'cm',
  'см',
  'qt',
  'gal',
  'fl oz',
  'lb',
  'oz',
  'ft',
  'in',
])
export function builtinPrecision(unit: string) {
  const code = unit.trim().toLocaleLowerCase('uk')
  return counts.has(code) ? 0 : measures.has(code) ? 3 : null
}
export async function assertProductQuantity(
  tx: Tx,
  ctx: LedgerContext,
  product: { id: string; unit: string | null; unitId?: string | null; trackingMode?: string },
  quantity: string,
  allowArchived = false
) {
  const [locked] = await tx.$queryRaw<
    { unit: string | null; unitId: string | null; trackingMode: string }[]
  >`SELECT unit,"unitId","trackingMode" FROM "public"."inventory_parts" WHERE id=${product.id} AND "organizationId"=${ctx.organizationId} FOR SHARE`
  if (
    !locked ||
    locked.unit !== product.unit ||
    (product.unitId !== undefined && locked.unitId !== product.unitId) ||
    (product.trackingMode !== undefined && locked.trackingMode !== product.trackingMode)
  )
    throw new Error('Товар змінено. Оновіть документ і повторіть операцію.')
  await tx.$queryRaw`SELECT id FROM "public"."units_of_measure" WHERE "organizationId"=${ctx.organizationId} AND (id=${locked.unitId ?? ''} OR code=${locked.unit ?? 'pcs'}) FOR SHARE`

  if (product.trackingMode === 'NON_STOCK') throw new Error('Ця позиція не ведеться на складі')
  const unit = await tx.unitOfMeasure.findFirst({
    where: {
      organizationId: ctx.organizationId,
      ...(product.unitId ? { id: product.unitId } : { code: product.unit ?? 'pcs' }),
    },
  })
  if (unit?.archivedAt && !allowArchived) throw new Error('Одиницю виміру архівовано')
  const precision = unit?.precision ?? builtinPrecision(product.unit ?? 'pcs')
  if (precision === null)
    throw new Error('Налаштуйте точність одиниці «' + product.unit + '» у довіднику')
  if (D(quantity).decimalPlaces() > precision)
    throw new Error(
      precision === 0
        ? 'Штучний товар потребує цілої кількості'
        : `Одиниця ${product.unit} допускає ${precision} знаки після крапки`
    )
  return precision
}
const revision = {
  id: z.string().optional(),
  expectedVersion: z.number().int().positive().optional(),
  archived: z.boolean().default(false),
}
export function catalogOperations(db: LedgerDB, ctx: LedgerContext) {
  const org = { organizationId: ctx.organizationId }
  return {
    unit(raw: unknown) {
      const input = commandSchema
        .extend({
          ...revision,
          code: z.string().trim().min(1).max(30),
          name: z.string().trim().min(1).max(100),
          precision: z.number().int().min(0).max(3),
        })
        .parse(raw)
      return ledgerCommand(db, ctx, 'catalog.unit', input, async (tx) => {
        const standard = builtinPrecision(input.code)
        if (standard !== null && standard !== input.precision)
          throw new Error('Для стандартної одиниці точність фіксована; створіть окрему одиницю')
        const old = input.id
          ? await tx.unitOfMeasure.findFirst({
              where: { ...org, id: input.id, version: input.expectedVersion },
            })
          : null
        if (input.id && (!input.expectedVersion || !old))
          throw new Error('Одиницю змінено. Оновіть довідник.')
        const history = await tx.stockLot.count({
          where: { ...org, inventoryPart: { unit: old?.code ?? input.code } },
        })
        if (
          history &&
          (input.code !== (old?.code ?? input.code) ||
            input.precision !== (old?.precision ?? builtinPrecision(input.code) ?? 3))
        )
          throw new Error('Одиниця з історичними рухами незмінна')
        const data = {
          code: input.code,
          name: input.name,
          precision: input.precision,
          archivedAt: input.archived ? new Date() : null,
        }
        const row = old
          ? await tx.unitOfMeasure.update({
              where: { id: old.id },
              data: { ...data, version: { increment: 1 } },
            })
          : await tx.unitOfMeasure.create({ data: { ...metadata(ctx), ...data } })
        return {
          id: row.id,
          version: row.version,
          before: old ? { code: old.code, precision: old.precision } : null,
        }
      })
    },
    location(raw: unknown) {
      const input = commandSchema
        .extend({
          ...revision,
          warehouseId: z.string().min(1),
          code: z.string().trim().min(1).max(50),
          name: z.string().trim().min(1).max(100),
        })
        .parse(raw)
      return ledgerCommand(db, ctx, 'catalog.location', input, async (tx) => {
        await tx.warehouse.findFirstOrThrow({
          where: { ...org, id: input.warehouseId, archivedAt: null },
        })
        const old = input.id
          ? await tx.warehouseLocation.findFirst({
              where: { ...org, id: input.id, version: input.expectedVersion },
            })
          : null
        if (input.id && (!input.expectedVersion || !old))
          throw new Error('Місце змінено. Оновіть довідник.')
        if (old && input.warehouseId !== old.warehouseId)
          throw new Error('Для іншого складу створіть окреме місце')
        if (
          old &&
          input.archived &&
          (await tx.inventoryPart.count({
            where: { ...org, locationId: old.id, isArchived: false },
          }))
        )
          throw new Error('Спочатку змініть місце зберігання в картках товарів')
        const data = {
          warehouseId: input.warehouseId,
          code: input.code,
          name: input.name,
          archivedAt: input.archived ? new Date() : null,
        }
        const row = old
          ? await tx.warehouseLocation.update({
              where: { id: old.id },
              data: { ...data, version: { increment: 1 } },
            })
          : await tx.warehouseLocation.create({ data: { ...metadata(ctx), ...data } })
        return { id: row.id, version: row.version }
      })
    },
    supplierProduct(raw: unknown) {
      const input = commandSchema
        .extend({
          inventoryPartId: z.string().min(1),
          supplierId: z.string().min(1),
          expectedVersion: z.number().int().nonnegative(),
          supplierArticle: z.string().trim().max(100).default(''),
          lastQuotedPrice: decimalText.nullable().default(null),
          leadTimeDays: z.number().int().min(0).max(365).nullable().default(null),
          preferred: z.boolean().default(false),
          archived: z.boolean().default(false),
        })
        .parse(raw)
      return ledgerCommand(db, ctx, 'catalog.supplierProduct', input, async (tx) => {
        await tx.inventoryPart.findFirstOrThrow({
          where: { ...org, id: input.inventoryPartId, isArchived: false },
        })
        await tx.supplier.findFirstOrThrow({
          where: {
            ...org,
            id: input.supplierId,
            archivedAt: null,
            kind: { in: ['GOODS', 'BOTH'] },
          },
        })
        const old = await tx.supplierProduct.findUnique({
          where: {
            organizationId_supplierId_inventoryPartId: {
              ...org,
              supplierId: input.supplierId,
              inventoryPartId: input.inventoryPartId,
            },
          },
        })
        if ((old?.version ?? 0) !== input.expectedVersion)
          throw new Error('Пропозицію змінено. Оновіть картку товару.')
        const displaced = input.preferred
          ? await tx.supplierProduct.findMany({
              where: {
                ...org,
                inventoryPartId: input.inventoryPartId,
                preferred: true,
                NOT: { supplierId: input.supplierId },
              },
              select: { id: true },
            })
          : []
        if (displaced.length)
          await tx.supplierProduct.updateMany({
            where: { ...org, id: { in: displaced.map((r) => r.id) } },
            data: { preferred: false, version: { increment: 1 } },
          })
        const data = {
          supplierArticle: input.supplierArticle || null,
          lastQuotedPrice: input.lastQuotedPrice,
          leadTimeDays: input.leadTimeDays,
          preferred: input.preferred && !input.archived,
          archivedAt: input.archived ? new Date() : null,
        }
        const row = old
          ? await tx.supplierProduct.update({
              where: { id: old.id },
              data: { ...data, version: { increment: 1 } },
            })
          : await tx.supplierProduct.create({
              data: {
                ...metadata(ctx),
                supplierId: input.supplierId,
                inventoryPartId: input.inventoryPartId,
                ...data,
              },
            })
        return { id: row.id, version: row.version, previousPreferred: displaced.map((r) => r.id) }
      })
    },
    product(raw: unknown) {
      const input = commandSchema
        .extend({
          inventoryPartId: z.string().min(1),
          expectedUpdatedAt: z.iso.datetime(),
          unitId: z.string().min(1).nullable(),
          locationId: z.string().nullable(),
          trackingMode: z.enum(['STOCK', 'NON_STOCK']),
        })
        .parse(raw)
      return ledgerCommand(db, ctx, 'catalog.product', input, async (tx) => {
        const product = await tx.inventoryPart.findFirstOrThrow({
          where: {
            ...org,
            id: input.inventoryPartId,
            updatedAt: new Date(input.expectedUpdatedAt),
          },
        })
        const unit = input.unitId
          ? await tx.unitOfMeasure.findFirstOrThrow({
              where: { ...org, id: input.unitId, archivedAt: null },
            })
          : null
        if (input.locationId)
          await tx.warehouseLocation.findFirstOrThrow({
            where: {
              ...org,
              id: input.locationId,
              archivedAt: null,
              warehouse: { archivedAt: null },
            },
          })
        const row = await tx.inventoryPart.update({
          where: { id: product.id },
          data: {
            unit: unit?.code ?? product.unit,
            unitId: unit?.id ?? null,
            locationId: input.locationId,
            trackingMode: input.trackingMode,
          },
        })
        return {
          id: row.id,
          updatedAt: row.updatedAt.toISOString(),
          before: {
            unit: product.unit,
            locationId: product.locationId,
            trackingMode: product.trackingMode,
          },
        }
      })
    },
  }
}
