import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  brandDirectory,
  saveBrand,
  changeBrandAvailability,
} from '@/features/inventory/Actions/manageBrands'
const state = vi.hoisted(() => ({
  permissions: [] as { action: string; subject: string }[],
  admin: false,
  save: vi.fn(),
  availability: vi.fn(),
  list: vi.fn(),
}))
vi.mock('@/lib/with-auth', () => ({
  withAuth: async (
    fn: (ctx: unknown) => unknown,
    options: { requiredPermissions: { action: string; subject: string }[] }
  ) => {
    const allowed =
      state.admin ||
      options.requiredPermissions.every((r) =>
        state.permissions.some((p) => p.action === r.action && p.subject === r.subject)
      )
    if (!allowed) return { success: false, forbidden: true }
    try {
      return { success: true, data: await fn({ userId: 'user', isAdmin: state.admin }) }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  },
}))
vi.mock('@/lib/cached-session', () => ({
  getCachedMembership: async () => ({ customRole: { permissions: state.permissions } }),
}))
vi.mock('@/lib/db', () => ({
  db: {
    $transaction: async (fn: (tx: unknown) => unknown) => fn({}),
    brand: { findMany: state.list },
  },
}))
vi.mock('@/features/inventory/Lib/saveBrandRecord', () => ({
  saveBrandRecord: state.save,
  setBrandAvailability: state.availability,
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
function grant(...actions: string[]) {
  state.permissions = actions.map((action) => ({ subject: 'brands', action }))
}
beforeEach(() => {
  state.permissions = []
  state.admin = false
  vi.clearAllMocks()
  state.list.mockResolvedValue([])
  state.save.mockResolvedValue({ id: 'b' })
  state.availability.mockResolvedValue({ id: 'b' })
})
describe('brand directory role permissions', () => {
  it('refuses directory reads without the brand permission, even with inventory access', async () => {
    state.permissions = [{ subject: 'inventory', action: 'read' }]
    expect(await brandDirectory()).toMatchObject({ forbidden: true })
    expect(state.list).not.toHaveBeenCalled()
  })
  it('returns separate capabilities for a read-only member', async () => {
    grant('read')
    expect(await brandDirectory()).toMatchObject({
      data: { canCreate: false, canEdit: false, canDelete: false },
    })
    expect(await saveBrand({ name: 'Test' })).toMatchObject({ forbidden: true })
    expect(state.save).not.toHaveBeenCalled()
  })
  it('create cannot rename or deactivate brands', async () => {
    grant('read', 'create')
    expect(await saveBrand({ name: ' Test ', isActive: false })).toMatchObject({ success: true })
    expect(state.save).toHaveBeenCalledWith({}, { name: 'Test' })
    expect(await saveBrand({ id: 'b', name: 'Changed' })).toMatchObject({ forbidden: true })
    expect(await changeBrandAvailability('b', false)).toMatchObject({ forbidden: true })
  })
  it('edit cannot bypass the delete permission using the save payload', async () => {
    grant('read', 'update')
    expect(await saveBrand({ id: 'b', name: 'Changed', isActive: false })).toMatchObject({
      success: true,
    })
    expect(state.save).toHaveBeenCalledWith({}, { id: 'b', name: 'Changed' })
    expect(await changeBrandAvailability('b', false)).toMatchObject({ forbidden: true })
    expect(await changeBrandAvailability('b', true)).toMatchObject({ success: true })
  })
  it('delete can deactivate but cannot rename or create', async () => {
    grant('read', 'delete')
    expect(await changeBrandAvailability('b', false)).toMatchObject({ success: true })
    expect(state.availability).toHaveBeenCalledWith({}, 'b', false)
    expect(await saveBrand({ id: 'b', name: 'Changed' })).toMatchObject({ forbidden: true })
    expect(await saveBrand({ name: 'New' })).toMatchObject({ forbidden: true })
  })
  it('protects the system brand even for administrators', async () => {
    state.admin = true
    expect(await saveBrand({ id: 'brand_unknown', name: 'Changed' })).toMatchObject({
      success: false,
    })
    expect(state.save).not.toHaveBeenCalled()
  })
})
