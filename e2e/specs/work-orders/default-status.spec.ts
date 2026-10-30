import { expect, test } from '@playwright/test'
import { settle } from '../../support/hydration'
import { addPart, newWorkOrder, saveWorkOrder, seededVehicleUrl } from '../../support/work-order'

test('work order list defaults to Active, excludes completed jobs and preserves explicit status links', async ({
  page,
}) => {
  const title = `E2E completed filter ${Date.now()}`
  await newWorkOrder(page, await seededVehicleUrl(page), title)
  await addPart(page, { name: 'Filter fixture', quantity: 1, unitPrice: 10 })
  await page
    .getByTestId('status-stepper')
    .getByRole('button', { name: /Completed/ })
    .click()
  await saveWorkOrder(page)
  const number = await page.getByLabel('Invoice Number').inputValue()

  await page.goto(`/work-orders?search=${encodeURIComponent(title)}`)
  await settle(page)
  await expect(page.getByRole('columnheader', { name: 'Title', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Active', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(page.getByText(number, { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await expect(page).toHaveURL(/status=all/)
  await expect(page.getByText(number, { exact: true }).filter({ visible: true })).toBeVisible()
  await page.reload()
  await settle(page)
  await expect(page.getByRole('button', { name: 'All', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(page.getByText(number, { exact: true }).filter({ visible: true })).toBeVisible()
  await page.goto(`/work-orders?status=completed&search=${encodeURIComponent(title)}`)
  await expect(page.getByRole('button', { name: /^Completed/ })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(page.getByText(number, { exact: true }).filter({ visible: true })).toBeVisible()
  await page.goto('/work-orders')
  await expect(page.getByRole('button', { name: 'Active', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
})
