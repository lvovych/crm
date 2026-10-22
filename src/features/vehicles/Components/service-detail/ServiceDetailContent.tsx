import type { ReactNode } from 'react'
export function ServiceDetailContent({
  leftColumn,
  rightColumn,
}: {
  leftColumn: ReactNode
  rightColumn: ReactNode
}) {
  return (
    <div className="relative min-h-0 flex-1">
      <div
        data-testid="service-layout"
        className="absolute inset-0 overflow-y-auto overscroll-contain p-4 pb-40"
      >
        <div className="mx-auto flex max-w-[1600px] flex-col gap-3">
          <div data-testid="service-main" className="min-w-0">
            {leftColumn}
          </div>
          <div data-testid="service-secondary" className="min-w-0">
            {rightColumn}
          </div>
        </div>
      </div>
    </div>
  )
}
