import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DocumentTabs } from '@/components/operations/document-tabs'

describe('document workspaces', () => {
  it('retains an unsaved form when moving between document sections', () => {
    render(
      <DocumentTabs
        tabs={[
          { id: 'items', label: 'Позиції', content: <p>Товари</p> },
          {
            id: 'payment',
            label: 'Оплата',
            content: (
              <label>
                Сума
                <input defaultValue="" />
              </label>
            ),
          },
        ]}
      />
    )
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Оплата' }), { button: 0, ctrlKey: false })
    fireEvent.change(screen.getByLabelText('Сума'), { target: { value: '123' } })
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Позиції' }), { button: 0, ctrlKey: false })
    expect(screen.getByRole('tab', { name: 'Позиції' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Оплата' }), { button: 0, ctrlKey: false })
    expect(screen.getByLabelText('Сума')).toHaveValue('123')
  })
  it('falls back to an available section when a requested section is not permitted', () => {
    render(
      <DocumentTabs
        initial="payment"
        tabs={[{ id: 'items', label: 'Позиції', content: <p>Товари</p> }]}
      />
    )
    expect(screen.getByRole('tab', { name: 'Позиції' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('tab', { name: 'Оплата' })).not.toBeInTheDocument()
  })
  it('opens a linked section directly', () => {
    render(
      <DocumentTabs
        initial="returns"
        tabs={[
          { id: 'items', label: 'Позиції', content: null },
          { id: 'returns', label: 'Повернення', content: null },
        ]}
      />
    )
    expect(screen.getByRole('tab', { name: 'Повернення' })).toHaveAttribute('aria-selected', 'true')
  })
})
