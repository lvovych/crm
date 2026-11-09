import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useHardwareScanner } from '@/hooks/use-hardware-scanner'
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-09T12:00:00Z'))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  document.body.innerHTML = ''
})
function key(target: HTMLElement, value: string) {
  const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}
function target(tag = 'button') {
  const el = document.createElement(tag)
  document.body.appendChild(el)
  return el
}
function type(el: HTMLElement, text: string, gap: number) {
  for (const value of text) {
    act(() => vi.advanceTimersByTime(gap))
    key(el, value)
  }
}
describe('scanner does not swallow ordinary keyboard actions', () => {
  it.each([
    'button',
    'a',
    'input',
    'textarea',
  ])('preserves Enter on %s without a barcode', (tag) => {
    const onScan = vi.fn()
    renderHook(() => useHardwareScanner({ onScan }))
    expect(key(target(tag), 'Enter').defaultPrevented).toBe(false)
    expect(onScan).not.toHaveBeenCalled()
  })
  it('preserves Enter after slow typing', () => {
    const onScan = vi.fn()
    renderHook(() => useHardwareScanner({ onScan }))
    const el = target()
    type(el, 'ABCD', 120)
    expect(key(el, 'Enter').defaultPrevented).toBe(false)
    expect(onScan).not.toHaveBeenCalled()
  })
  it('preserves Enter after fewer than four rapid characters', () => {
    const onScan = vi.fn()
    renderHook(() => useHardwareScanner({ onScan }))
    const el = target()
    type(el, 'ABC', 20)
    expect(key(el, 'Enter').defaultPrevented).toBe(false)
    expect(onScan).not.toHaveBeenCalled()
  })
  it('consumes a genuine scan once without activating a focused button', () => {
    const onScan = vi.fn()
    renderHook(() => useHardwareScanner({ onScan }))
    const el = target()
    const listener = vi.fn()
    el.addEventListener('keydown', listener)
    type(el, '12345678', 20)
    listener.mockClear()
    expect(key(el, 'Enter').defaultPrevented).toBe(true)
    expect(listener).not.toHaveBeenCalled()
    expect(onScan).toHaveBeenCalledExactlyOnceWith('12345678')
    key(el, 'Enter')
    expect(onScan).toHaveBeenCalledTimes(1)
  })
  it('resets an expired scan and preserves Enter', () => {
    const onScan = vi.fn()
    renderHook(() => useHardwareScanner({ onScan }))
    const el = target()
    type(el, '12345', 20)
    act(() => vi.advanceTimersByTime(301))
    expect(key(el, 'Enter').defaultPrevented).toBe(false)
    expect(onScan).not.toHaveBeenCalled()
  })
  it('leaves keyboard handling alone when disabled', () => {
    const onScan = vi.fn()
    renderHook(() => useHardwareScanner({ onScan, enabled: false }))
    const el = target()
    type(el, '12345', 20)
    expect(key(el, 'Enter').defaultPrevented).toBe(false)
    expect(onScan).not.toHaveBeenCalled()
  })
})
