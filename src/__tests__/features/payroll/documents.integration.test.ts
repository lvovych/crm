// @vitest-environment node
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
const state = vi.hoisted(() => ({
  db: null as unknown as PrismaClient,
  org: '',
  admin: true,
  permissions: [] as { action: string; subject: string }[],
  actor: 'finance-test-actor',
}))
vi.mock('@/lib/db', () => ({
  db: new Proxy(
    {},
    {
      get: (_target, key) => {
        const value = Reflect.get(state.db, key)
        return typeof value === 'function' ? value.bind(state.db) : value
      },
    }
  ),
}))
vi.mock('@/lib/with-auth', () => ({
  withAuth: async (
    fn: (ctx: unknown) => Promise<unknown>,
    options?: {
      requiredPermissions?: { action: string; subject: string }[]
    }
  ) => {
    try {
      if (
        !state.admin &&
        !options?.requiredPermissions?.every((required) =>
          state.permissions.some(
            (p) => p.action === required.action && p.subject === required.subject
          )
        )
      )
        throw new Error('Permission denied')
      return {
        success: true,
        data: await fn({
          organizationId: state.org,
          userId: state.actor,
          isAdmin: state.admin,
          isOrganizationOwner: state.admin,
          role: 'owner',
          isSuperAdmin: false,
        }),
      }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  },
}))
vi.mock('@/lib/cached-session', () => ({
  getCachedMembership: vi.fn(async () => ({
    organizationId: state.org,
    roleId: 'configuration-role',
    customRole: { permissions: state.permissions },
  })),
}))
vi.mock('@/lib/workshop-timezone', () => ({ workshopTimeZone: async () => 'Europe/Kyiv' }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import {
  previewDocument,
  saveSalaryDocument,
  postSalaryDocument,
  saveCommissionRule,
  payrollWorkspace,
} from '@/features/payroll/document-actions'
import { calculateDocument } from '@/features/payroll/document-calculation'
const url = process.env.FINANCE_TEST_DATABASE_URL

describe.skipIf(!url)('Period salary documents on PostgreSQL', () => {
  let manager: string, mechanic: string, order: string
  const period = { start: '2026-11-09', end: '2026-11-15' }
  beforeAll(async () => {
    if (
      !url ||
      !['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
      !new URL(url).pathname.endsWith('_test')
    )
      throw new Error('Dedicated test database required')
    state.db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  })
  beforeEach(async () => {
    state.admin = true
    state.org = (
      await state.db.organization.create({ data: { name: 'Salary documents ' + randomUUID() } })
    ).id
    manager = (
      await state.db.technician.create({ data: { organizationId: state.org, name: 'Manager' } })
    ).id
    mechanic = (
      await state.db.technician.create({ data: { organizationId: state.org, name: 'Mechanic' } })
    ).id
    for (const [employee, basis, rate, scope] of [
      [manager, 'partsMargin', 10, 'manager'],
      [manager, 'managerLabor', 5, 'manager'],
      [mechanic, 'labor', 40, 'performer'],
    ] as const) {
      const result = await saveCommissionRule({
        employee,
        rule: {
          name: basis,
          basis,
          rate,
          scope,
          effective: '2026-11-01',
          enabled: true,
          afterDiscount: true,
          deductMechanicPay: true,
          deductSubcontractCost: true,
          includeNegative: false,
        },
      })
      expect(result.success, result.error).toBe(true)
    }
    order = (
      await state.db.serviceRecord.create({
        data: {
          organizationId: state.org,
          title: 'November order',
          invoiceNumber: randomUUID(),
          status: 'completed',
          payrollEarnedAt: new Date('2026-11-10T12:00:00Z'),
          serviceDate: new Date('2026-10-01'),
          subtotal: 15000,
          payAssignment: { create: { ownerId: manager } },
          laborItems: { create: { description: 'Own work', total: 5000, technicianId: mechanic } },
          partItems: {
            create: { name: 'Part', quantity: 1, unitPrice: 10000, total: 10000, unitCost: 7000 },
          },
        },
      })
    ).id
  })
  afterAll(async () => {
    await state.db?.$disconnect()
  })
  async function preview(employee = manager) {
    const result = await previewDocument({ employee, ...period })
    expect(result.success, result.error).toBe(true)
    return result.data!
  }
  async function draft() {
    const p = await preview(),
      id = randomUUID()
    const input = {
      id,
      existing: false,
      employee: manager,
      ...period,
      date: '2026-11-21',
      preview: p.fingerprint,
    }
    const result = await saveSalaryDocument(input)
    expect(result.success, result.error).toBe(true)
    return { id, revision: result.data!.revision, input }
  }
  it('serializes concurrent drafts so a period cannot be paid twice', async () => {
    const p = await preview()
    const make = () =>
      saveSalaryDocument({
        id: randomUUID(),
        existing: false,
        employee: manager,
        ...period,
        date: '2026-11-21',
        preview: p.fingerprint,
      })
    const results = await Promise.all([make(), make()])
    expect(results.filter((r) => r.success)).toHaveLength(1)
    expect(await state.db.paySlip.count({ where: { technicianId: manager } })).toBe(1)
  })
  it('rejects a changed retry, missing draft, stale preview and editing a posted document', async () => {
    const d = await draft()
    expect((await saveSalaryDocument({ ...d.input, date: '2026-11-22' })).success).toBe(false)
    expect(
      (
        await saveSalaryDocument({
          ...d.input,
          id: randomUUID(),
          existing: true,
          revision: d.revision,
        })
      ).success
    ).toBe(false)
    expect(
      (
        await saveSalaryDocument({
          ...d.input,
          existing: true,
          revision: d.revision,
          preview: 'tampered',
        })
      ).success
    ).toBe(false)
    expect((await postSalaryDocument(d)).success).toBe(true)
    expect(
      (await saveSalaryDocument({ ...d.input, existing: true, revision: d.revision })).success
    ).toBe(false)
  })
  it('returns empty-period and unresolved-executor diagnostics and refuses an empty document', async () => {
    await state.db.serviceRecord.update({ where: { id: order }, data: { invoiceNumber: null } })
    await state.db.serviceLabor.updateMany({
      where: { serviceRecordId: order },
      data: { technicianId: null, executorFrozen: true, executorName: 'Unknown' },
    })
    const p = await preview(mechanic)
    expect(p.details.lines).toHaveLength(0)
    expect(p.details.warnings?.[0]).toContain(order)
    expect(
      (
        await saveSalaryDocument({
          id: randomUUID(),
          existing: false,
          employee: mechanic,
          ...period,
          date: '2026-11-21',
          preview: p.fingerprint,
        })
      ).success
    ).toBe(false)
    const person = await state.db.technician.create({
      data: { organizationId: state.org, name: 'No rules' },
    })
    expect((await previewDocument({ employee: person.id, ...period })).success).toBe(false)
    expect(
      (await previewDocument({ employee: mechanic, start: period.end, end: period.start })).success
    ).toBe(false)
    await expect(
      state.db.$transaction((tx) =>
        calculateDocument(
          tx,
          state.org,
          mechanic,
          new Date(period.end),
          new Date(period.start),
          'Europe/Kyiv'
        )
      )
    ).rejects.toThrow()
  })
  it('checks stored totals and rule revisions before posting', async () => {
    const d = await draft()
    await state.db.paySlip.update({ where: { id: d.id }, data: { total: 1 } })
    const w = await payrollWorkspace(d.id)
    expect(
      (await postSalaryDocument({ id: d.id, revision: w.data!.documents[0].revision })).success
    ).toBe(false)
    const r = w.data!.people.find((p) => p.id === manager)!.rules[0]
    const revised = await saveCommissionRule({
      employee: manager,
      ruleKey: r.ruleKey,
      previous: r.id,
      rule: { ...r, rate: 20 },
    })
    expect(revised.success).toBe(true)
    expect(
      (
        await saveCommissionRule({
          employee: manager,
          ruleKey: r.ruleKey,
          previous: r.id,
          rule: { ...r, rate: 30 },
        })
      ).success
    ).toBe(false)
    expect(
      (await saveCommissionRule({ employee: manager, ruleKey: 'missing', previous: r.id, rule: r }))
        .success
    ).toBe(false)
    expect(
      (await postSalaryDocument({ id: d.id, revision: w.data!.documents[0].revision })).success
    ).toBe(false)
  })
  it.each([
    true,
    false,
  ])('recognizes already paid legacy order labels (array=%s)', async (array) => {
    const record = await state.db.serviceRecord.findUniqueOrThrow({ where: { id: order } })
    const lines = [{ order: record.invoiceNumber }]
    await state.db.paySlip.create({
      data: {
        technicianId: manager,
        start: new Date('2026-10-01'),
        end: new Date('2026-10-31'),
        total: 1,
        lines: array ? lines : { lines },
        actorId: state.actor,
        status: 'completed',
      },
    })
    const p = await preview()
    const result = await saveSalaryDocument({
      id: randomUUID(),
      existing: false,
      employee: manager,
      ...period,
      date: '2026-11-21',
      preview: p.fingerprint,
    })
    expect(result.error).toContain('уже врахований')
  })
  it('leaves unrelated old documents readable and retrieves an older document outside the first page', async () => {
    const d = await draft()
    await state.db.paySlip.update({
      where: { id: d.id },
      data: { createdAt: new Date('1970-01-01') },
    })
    await state.db.paySlip.createMany({
      data: Array.from({ length: 200 }, (_, i) => ({
        id: randomUUID(),
        technicianId: manager,
        start: new Date(Date.UTC(1800 + i, 0, 1)),
        end: new Date(Date.UTC(1800 + i, 0, 1)),
        total: 0,
        lines: [],
        actorId: state.actor,
        status: 'new',
      })),
    })
    const w = await payrollWorkspace(d.id)
    expect(w.data!.documents).toHaveLength(201)
    expect(w.data!.documents[0].id).toBe(d.id)
    expect((await payrollWorkspace('missing')).data!.documents).toHaveLength(200)
    expect((await payrollWorkspace(w.data!.documents[1].id)).data!.documents).toHaveLength(200)
  })
  it('includes legacy salary flags and protects archived employment date boundaries', async () => {
    await state.db.payPlan.create({
      data: {
        technicianId: mechanic,
        effective: new Date('2026-01-01'),
        frequency: 'weekly',
        monthly: 5000,
        labor: 0,
        partsSales: 0,
        partsMargin: 0,
        orderMargin: 0,
      },
    })
    await state.db.technician.update({
      where: { id: mechanic },
      data: {
        hiredOn: new Date('2026-11-11'),
        dismissedOn: new Date('2026-11-12'),
        isActive: false,
      },
    })
    const w = await payrollWorkspace()
    expect(w.data!.people.find((p) => p.id === mechanic)).toMatchObject({
      legacySalary: true,
      active: false,
      dismissed: true,
    })
    expect((await preview(mechanic)).details.lines).toHaveLength(0)
  })
  it('requires explicit overlap consent even when the other rule starts in the future', async () => {
    const w = await payrollWorkspace(),
      r = w.data!.people.find((p) => p.id === manager)!.rules[0]
    expect(
      (
        await saveCommissionRule({
          employee: manager,
          rule: { ...r, basis: 'orderMargin', scope: 'workshop', effective: '2026-12-01' },
          allowOverlap: true,
        })
      ).success
    ).toBe(true)
    expect(
      (
        await saveCommissionRule({
          employee: manager,
          rule: { ...r, basis: 'orderMargin', scope: 'workshop' },
        })
      ).success
    ).toBe(false)
    expect(
      (await saveCommissionRule({ employee: manager, rule: { ...r, enabled: false } })).success
    ).toBe(true)
  })
  it('uses closure date rather than service or document date, and itemizes each position', async () => {
    expect((await preview()).details.total).toBe('450.00')
    expect((await preview(mechanic)).details.total).toBe('2000.00')
    await state.db.serviceRecord.update({ where: { id: order }, data: { status: 'in_progress' } })
    expect((await preview()).details.lines).toHaveLength(0)
    expect(
      (await state.db.serviceRecord.findUniqueOrThrow({ where: { id: order } })).payrollEarnedAt
    ).toBeNull()
    await state.db.serviceRecord.update({ where: { id: order }, data: { status: 'completed' } })
    expect(
      (
        await state.db.serviceRecord.findUniqueOrThrow({ where: { id: order } })
      ).payrollEarnedAt!.getTime()
    ).toBeGreaterThan(Date.now() - 10000)
  })
  it('saves idempotently, posts once, keeps a snapshot, and rejects overlapping periods', async () => {
    const d = await draft()
    expect((await saveSalaryDocument(d.input)).success).toBe(true)
    expect((await postSalaryDocument(d)).success).toBe(true)
    expect((await postSalaryDocument(d)).success).toBe(true)
    const snapshot = (await state.db.paySlip.findUniqueOrThrow({ where: { id: d.id } })).lines
    await state.db.serviceLabor.updateMany({
      where: { serviceRecordId: order },
      data: { total: 9000 },
    })
    expect((await state.db.paySlip.findUniqueOrThrow({ where: { id: d.id } })).lines).toEqual(
      snapshot
    )
    const fresh = await preview()
    const duplicate = await saveSalaryDocument({
      ...d.input,
      id: randomUUID(),
      preview: fresh.fingerprint,
    })
    expect(duplicate.success).toBe(false)
    expect(duplicate.error).toContain('період')
  })
  it('rejects stale draft posting after work, closure or rules change', async () => {
    const d = await draft()
    await state.db.serviceRecord.update({ where: { id: order }, data: { status: 'in_progress' } })
    const posted = await postSalaryDocument(d)
    expect(posted.success).toBe(false)
    expect((await state.db.paySlip.findUniqueOrThrow({ where: { id: d.id } })).status).toBe('new')
  })
  it('refreshes a draft only after a new preview and rejects an obsolete revision', async () => {
    const d = await draft()
    await state.db.servicePart.updateMany({
      where: { serviceRecordId: order },
      data: { unitCost: 8000 },
    })
    const fresh = await preview()
    const saved = await saveSalaryDocument({
      ...d.input,
      existing: true,
      revision: d.revision,
      preview: fresh.fingerprint,
    })
    expect(saved.success, saved.error).toBe(true)
    expect(
      (
        await saveSalaryDocument({
          ...d.input,
          existing: true,
          revision: d.revision,
          preview: fresh.fingerprint,
        })
      ).success
    ).toBe(false)
    expect((await postSalaryDocument({ id: d.id, revision: saved.data!.revision })).success).toBe(
      true
    )
  })
  it('detects metadata-only edits from another tab', async () => {
    const d = await draft()
    const saved = await saveSalaryDocument({
      ...d.input,
      existing: true,
      revision: d.revision,
      date: '2026-11-22',
    })
    expect(saved.success, saved.error).toBe(true)
    expect(saved.data!.revision).not.toBe(d.revision)
    expect((await postSalaryDocument(d)).success).toBe(false)
    expect(
      (await saveSalaryDocument({ ...d.input, existing: true, revision: d.revision })).success
    ).toBe(false)
    expect((await postSalaryDocument({ id: d.id, revision: saved.data!.revision })).success).toBe(
      true
    )
  })
  it('protects posted snapshots and rule history at the database boundary', async () => {
    const d = await draft()
    expect((await postSalaryDocument(d)).success).toBe(true)
    await expect(
      state.db.paySlip.update({ where: { id: d.id }, data: { total: 1 } })
    ).rejects.toThrow()
    await expect(state.db.paySlip.delete({ where: { id: d.id } })).rejects.toThrow()
    const rule = await state.db.employeePayRule.findFirstOrThrow({
      where: { technicianId: manager },
    })
    await expect(
      state.db.employeePayRule.update({ where: { id: rule.id }, data: { rate: 99 } })
    ).rejects.toThrow()
    await expect(state.db.employeePayRule.delete({ where: { id: rule.id } })).rejects.toThrow()
    expect(
      (await state.db.paySlip.findUniqueOrThrow({ where: { id: d.id } })).total.toFixed(2)
    ).toBe('450.00')
  })
  it('resolves the frozen inherited mechanic used by the order UI', async () => {
    await state.db.serviceRecord.update({ where: { id: order }, data: { technicianId: mechanic } })
    await state.db.serviceLabor.updateMany({
      where: { serviceRecordId: order },
      data: { technicianId: null, executorName: 'Mechanic', executorFrozen: true },
    })
    const p = await preview(mechanic)
    expect(p.details.total).toBe('2000.00')
    expect(p.details.lines[0].executorLabel).toBe('Mechanic')
    expect((await preview()).details.total).toBe('450.00')
    await state.db.serviceRecord.update({ where: { id: order }, data: { technicianId: manager } })
    expect((await preview(mechanic)).details.total).toBe('2000.00')
  })
  it('pays a workshop manager without per-order assignment and keeps tenant isolation', async () => {
    const workspace = await payrollWorkspace()
    for (const r of workspace.data!.people.find((p) => p.id === manager)!.rules) {
      const saved = await saveCommissionRule({
        employee: manager,
        ruleKey: r.ruleKey,
        previous: r.id,
        rule: { ...r, scope: 'workshop' },
      })
      expect(saved.success, saved.error).toBe(true)
    }
    await state.db.payAssignment.deleteMany({ where: { orderId: order } })
    const otherOrg = await state.db.organization.create({ data: { name: 'Other workshop' } })
    await state.db.serviceRecord.create({
      data: {
        organizationId: otherOrg.id,
        title: 'Foreign',
        status: 'completed',
        payrollEarnedAt: new Date('2026-11-10'),
        partItems: {
          create: {
            name: 'Foreign part',
            total: 90000,
            unitPrice: 90000,
            unitCost: 1,
            quantity: 1,
          },
        },
      },
    })
    const p = await preview()
    expect(p.details.total).toBe('450.00')
    expect(new Set(p.details.lines.map((l) => l.orderId))).toEqual(new Set([order]))
    const d = await draft()
    expect((await postSalaryDocument(d)).success).toBe(true)
  })
  it('does not pay a reopened order a second time in a different period', async () => {
    const d = await draft()
    expect((await postSalaryDocument(d)).success).toBe(true)
    await state.db.serviceRecord.update({
      where: { id: order },
      data: { payrollEarnedAt: new Date('2026-11-17') },
    })
    const p = await previewDocument({ employee: manager, start: '2026-11-16', end: '2026-11-22' })
    const repeated = await saveSalaryDocument({
      id: randomUUID(),
      existing: false,
      employee: manager,
      start: '2026-11-16',
      end: '2026-11-22',
      date: '2026-11-21',
      preview: p.data!.fingerprint,
    })
    expect(repeated.success).toBe(false)
    expect(repeated.error).toContain('уже врахований')
  })
  it('enforces tenant boundaries and manage permission', async () => {
    const d = await draft(),
      org = state.org
    state.org = (await state.db.organization.create({ data: { name: 'Other tenant' } })).id
    expect((await previewDocument({ employee: manager, ...period })).success).toBe(false)
    expect((await postSalaryDocument(d)).success).toBe(false)
    state.org = org
    state.admin = false
    state.permissions = [{ action: 'read', subject: 'payroll' }]
    expect((await postSalaryDocument(d)).success).toBe(false)
  })
  it('keeps rule history and explicitly confirms overlapping bases', async () => {
    const workspace = await payrollWorkspace()
    const r = workspace
      .data!.people.find((p) => p.id === manager)!
      .rules.find((r) => r.basis === 'partsMargin')!
    const edit = await saveCommissionRule({
      employee: manager,
      ruleKey: r.ruleKey,
      previous: r.id,
      rule: { ...r, rate: 20, effective: '2026-11-12' },
    })
    expect(edit.success, edit.error).toBe(true)
    expect((await preview()).details.total).toBe('450.00')
    await state.db.serviceRecord.update({
      where: { id: order },
      data: { payrollEarnedAt: new Date('2026-11-13') },
    })
    expect((await preview()).details.total).toBe('750.00')
    const duplicate = await saveCommissionRule({ employee: manager, rule: { ...r, rate: 5 } })
    expect(duplicate.success).toBe(false)
    expect(await state.db.employeePayRule.count({ where: { technicianId: manager } })).toBe(3)
  })
})
