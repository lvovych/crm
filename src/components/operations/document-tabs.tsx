'use client'
import type { ReactNode } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

export function DocumentTabs({
  tabs,
  initial,
}: {
  tabs: { id: string; label: string; content: ReactNode }[]
  initial?: string
}) {
  return (
    <Tabs
      defaultValue={tabs.some((t) => t.id === initial) ? initial : tabs[0]?.id}
      className="min-w-0 gap-5"
    >
      <div className="overflow-x-auto border-b">
        <TabsList
          variant="line"
          className="h-auto min-h-12 justify-start gap-2"
          aria-label="Розділи документа"
        >
          {tabs.map((t) => (
            <TabsTrigger key={t.id} value={t.id} className="min-h-11 shrink-0 px-4">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {tabs.map((t) => (
        <TabsContent
          key={t.id}
          value={t.id}
          forceMount
          className="min-w-0 space-y-5 data-[state=inactive]:hidden"
        >
          {t.content}
        </TabsContent>
      ))}
    </Tabs>
  )
}
