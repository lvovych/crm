import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScheduleTimesSection } from '@/features/vehicles/Components/service-edit/ScheduleTimesSection'
import { WorkOrderLayoutProvider } from '@/components/work-order-layout-context'
import {
  assignTechnician,
  scheduleJob,
  getTechnicianDayLoad,
} from '@/features/workboard/Actions/boardActions'
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/features/workboard/Actions/boardActions', () => ({
  assignTechnician: vi.fn(),
  scheduleJob: vi.fn(),
  getTechnicianDayLoad: vi.fn(),
  checkSlotAvailability: vi.fn().mockResolvedValue({ success: true, data: { conflicts: [] } }),
  setPromisedTime: vi.fn(),
  updateServiceTimes: vi.fn(),
  findNextSlot: vi.fn(),
}))
vi.mock('@/features/workboard/Actions/technicianActions', () => ({ createTechnician: vi.fn() }))
vi.mock('@/features/team/Components/AddPersonDialog', () => ({ AddPersonDialog: () => null }))
vi.mock('@/components/date-settings-context', () => ({
  useDateSettings: () => ({ timezone: 'Europe/Kyiv' }),
}))
vi.mock('@/components/ui/datetime-picker', () => ({ DateTimePicker: () => null }))
afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(assignTechnician).mockResolvedValue({ success: true } as never)
  vi.mocked(scheduleJob).mockResolvedValue({ success: true } as never)
  vi.mocked(getTechnicianDayLoad).mockResolvedValue({
    success: true,
    data: { minutes: {} },
  } as never)
})
function show(initialTechnicianId?: string) {
  return render(
    <WorkOrderLayoutProvider value="modern">
      <ScheduleTimesSection
        serviceRecordId="job"
        technicians={[
          { id: 'one', name: 'Ivan Mechanic' },
          { id: 'two', name: 'Andriy Mechanic' },
        ]}
        initialTechnicianId={initialTechnicianId}
        afterAssignment={<p>Notes below mechanic</p>}
      />
    </WorkOrderLayoutProvider>
  )
}
async function open(name = 'Assign mechanic') {
  fireEvent.click(screen.getByRole('button', { name }))
  await screen.findByRole('dialog', { name: 'Choose mechanic' })
}
describe('mechanic assignment outside scheduling', () => {
  it('keeps the assigned mechanic out of planning, with assignment only in the upper section', () => {
    const { container } = show('one')
    expect(screen.getByTestId('assigned-mechanic')).toHaveTextContent('Ivan Mechanic')
    const planning = container.querySelector('details')!
    fireEvent.click(planning.querySelector('summary')!)
    expect(planning).not.toHaveTextContent('Ivan Mechanic')
    expect(planning.querySelector('[role="combobox"][aria-expanded]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Change mechanic' })).toBeVisible()
  })

  it('is visible while planning is collapsed; search narrows the names', async () => {
    const { container } = show()
    expect(container.querySelector('details')).not.toHaveAttribute('open')
    expect(screen.getByTestId('assigned-mechanic')).toHaveTextContent('Not assigned')
    await open()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search by name' }), {
      target: { value: 'ANDRIY' },
    })
    expect(screen.getByRole('radio', { name: /Andriy/ })).toBeVisible()
    expect(screen.queryByRole('radio', { name: /Ivan/ })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search by name' }), {
      target: { value: 'missing' },
    })
    expect(screen.getByText('No mechanics found')).toBeVisible()
  })
  it('persists assignment and shows the saved name', async () => {
    show()
    await open()
    fireEvent.click(screen.getByRole('radio', { name: /Ivan/ }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Choose mechanic' })).not.toBeInTheDocument()
    )
    expect(assignTechnician).toHaveBeenCalledWith({
      id: 'job',
      technicianId: 'one',
      type: 'serviceRecord',
    })
    expect(screen.getByTestId('assigned-mechanic')).toHaveTextContent('Ivan Mechanic')
  })
  it('removes only the assignment, leaving times and bay untouched', async () => {
    show('one')
    await open('Change mechanic')
    fireEvent.click(screen.getByRole('button', { name: 'Remove assignment' }))
    await waitFor(() =>
      expect(screen.getByTestId('assigned-mechanic')).toHaveTextContent('Not assigned')
    )
    expect(scheduleJob).toHaveBeenCalledExactlyOnceWith({
      id: 'job',
      type: 'serviceRecord',
      technicianId: null,
    })
  })
  it.each([
    'refusal',
    'network',
  ])('keeps the previous mechanic after %s and allows retry', async (kind) => {
    if (kind === 'refusal')
      vi.mocked(assignTechnician).mockResolvedValue({ success: false, error: 'Denied' } as never)
    else vi.mocked(assignTechnician).mockRejectedValue(new Error('Offline'))
    show('one')
    await open('Change mechanic')
    fireEvent.click(screen.getByRole('radio', { name: /Andriy/ }))
    await waitFor(() => expect(screen.getByRole('radio', { name: /Andriy/ })).toBeEnabled())
    expect(screen.getByTestId('assigned-mechanic')).toHaveTextContent('Ivan Mechanic')
    expect(screen.getAllByText(kind === 'refusal' ? 'Denied' : 'Offline').length).toBeGreaterThan(0)
  })
  it('prevents double assignment while a request is pending', async () => {
    let finish!: (value: never) => void
    vi.mocked(assignTechnician).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    show()
    await open()
    const radio = screen.getByRole('radio', { name: /Ivan/ })
    fireEvent.click(radio)
    fireEvent.click(radio)
    expect(assignTechnician).toHaveBeenCalledTimes(1)
    expect(radio).toBeDisabled()
    finish({ success: true } as never)
    await waitFor(() =>
      expect(screen.getByTestId('assigned-mechanic')).toHaveTextContent('Ivan Mechanic')
    )
  })
})
