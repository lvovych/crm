import { expect, test } from '@playwright/test'
import { settle } from '../../support/hydration'

for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })
    test('quick booking stays in calendar and survives reload', async ({ page }) => {
      await page.goto('/calendar?view=day&date=2027-05-12')
      await settle(page)
      await page.getByRole('button', { name: 'Book customer', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Book customer', exact: true })
      await expect(dialog).toBeVisible()
      await dialog.getByText(/Camry/i).first().click()
      const reason = `Quick booking ${viewport.name} ${Date.now()}`
      await dialog.getByLabel('Reason for visit').fill(reason)
      await dialog.getByLabel('Date', { exact: true }).fill('2027-05-13')
      await dialog.getByLabel('Start time').fill('11:30')
      await dialog.getByLabel('Duration').selectOption('90')
      const bounds = await dialog.boundingBox()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1)
      await dialog.getByRole('button', { name: 'Save booking', exact: true }).click()
      await expect(dialog).not.toBeVisible()
      await expect(page).toHaveURL(/calendar.*date=2027-05-13/)
      const cards = page.locator('[data-event-id^="booking_"]')
      await expect(cards.first()).toBeVisible()
      const id = await cards.last().getAttribute('data-event-id')
      await page.reload()
      await settle(page)
      const card = page.locator(`[data-event-id="${id}"]`)
      await expect(card).toBeVisible()
      const top = await card.evaluate((el) => parseFloat((el as HTMLElement).style.top))
      expect(top).toBe(690)
      await card.click()
      await page.getByRole('link', { name: /Open work order/i }).click()
      await expect(page.getByText(reason, { exact: true })).toBeVisible()
    })
    test('cancel does not create a booking', async ({ page }) => {
      await page.goto('/calendar?view=day&date=2027-05-14')
      await settle(page)
      const before = await page.locator('[data-event-id]').count()
      await page.getByRole('button', { name: 'Book customer', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Book customer', exact: true })
      await dialog.getByText(/Camry/i).first().click()
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(dialog).not.toBeVisible()
      expect(await page.locator('[data-event-id]').count()).toBe(before)
    })
  })
}

test.describe('mobile day navigation', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test('defaults to Day and navigates using the week strip', async ({ page }) => {
    await page.goto('/calendar?date=2027-05-12')
    await settle(page)
    await expect(page).toHaveURL(/view=day/)
    await expect(page.locator('[data-testid^="timegrid-day-"]')).toHaveCount(1)
    const strip = page.getByRole('navigation', { name: 'Week dates' })
    await expect(strip).toBeVisible()
    await strip.getByRole('button', { name: /13/ }).click()
    await expect(page).toHaveURL(/date=2027-05-13/)
    await expect(strip.getByRole('button', { name: /13/ })).toHaveAttribute('aria-pressed', 'true')
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    )
    expect(overflow).toBe(false)
  })
  test('preserves an explicitly selected Week view', async ({ page }) => {
    await page.goto('/calendar?view=week&date=2027-05-12')
    await settle(page)
    await expect(page.locator('[data-testid^="timegrid-day-"]')).toHaveCount(7)
    await expect(page).toHaveURL(/view=week/)
  })
})
