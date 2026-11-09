import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Page from '@/app/(authenticated)/directories/page'
const state = vi.hoisted(() => ({
  admin: false,
  enabled: true,
  permissions: [] as { subject: string; action: string }[],
}))
vi.mock('@/lib/with-auth', () => ({
  withAuth: async (fn: (ctx: unknown) => unknown) => ({
    data: await fn({ userId: 'u', organizationId: 'o', isAdmin: state.admin }),
  }),
}))
vi.mock('@/lib/cached-session', () => ({
  getCachedMembership: async () => ({ customRole: { permissions: state.permissions } }),
}))
vi.mock('@/lib/get-layout-data', () => ({ getLayoutData: async () => ({ status: 'ok' }) }))
vi.mock('@/features/suppliers/Lib/enabled', () => ({
  supplierDirectoryEnabled: () => state.enabled,
}))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))
vi.mock('@/components/page-header', () => ({ PageHeader: () => null }))
beforeEach(() => {
  state.admin = false
  state.enabled = true
  state.permissions = []
})
describe('directory access', () => {
  it('inventory read alone does not expose the brand directory', async () => {
    state.permissions = [{ subject: 'inventory', action: 'read' }]
    render(await Page())
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getByRole('link')).toHaveAttribute('href', '/inventory')
  })
  it('exposes only the separately permitted suppliers and brands', async () => {
    state.permissions = [
      { subject: 'brands', action: 'read' },
      { subject: 'suppliers', action: 'read' },
    ]
    render(await Page())
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/suppliers',
      '/directories/brands',
    ])
  })
  it('keeps the supplier rollout gate even for administrators', async () => {
    state.admin = true
    state.enabled = false
    render(await Page())
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).not.toContain(
      '/suppliers'
    )
    expect(screen.getAllByRole('link')).toHaveLength(5)
  })
  it('shows no cards to a role without read permissions', async () => {
    render(await Page())
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('directoryContent.noAccess')).toBeInTheDocument()
  })
})
