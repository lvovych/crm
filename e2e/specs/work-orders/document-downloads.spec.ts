import { expect, test } from '@playwright/test'
import { addPart, newWorkOrder, saveWorkOrder, seededVehicleUrl } from '../../support/work-order'
import { pdfContent } from '../../support/pdf'

test('invoice and completion act previews download files named after the work order', async ({
  page,
  context,
  baseURL,
}) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: (data: ShareData) => !!data.files?.length,
    })
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        const file = data.files?.[0]
        ;(window as any).__sharedPdf = {
          keys: Object.keys(data),
          name: file?.name,
          type: file?.type,
          prefix: file ? new TextDecoder().decode((await file.arrayBuffer()).slice(0, 5)) : '',
        }
      },
    })
  })
  await newWorkOrder(page, await seededVehicleUrl(page), `E2E invoice names ${Date.now()}`)
  await addPart(page, { name: 'Invoice download fixture', quantity: 1, unitPrice: 120 })
  await saveWorkOrder(page)
  const number = await page.getByLabel('Invoice Number').inputValue()
  expect(number).not.toBe('')
  await page
    .getByRole('button', { name: 'Preview', exact: true })
    .filter({ visible: true })
    .first()
    .click()
  const dialog = page.getByRole('dialog', { name: 'PDF preview', exact: false })
  const link = dialog.getByRole('link', { name: 'Download', exact: true })
  await expect(link).toHaveAttribute('download', `invoice-${number}.pdf`)
  const invoiceDownload = page.waitForEvent('download')
  await link.click()
  expect((await invoiceDownload).suggestedFilename()).toBe(`invoice-${number}.pdf`)
  await dialog.getByRole('button', { name: 'Share PDF', exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => (window as any).__sharedPdf))
    .toEqual({
      keys: ['files'],
      name: `invoice-${number}.pdf`,
      type: 'application/pdf',
      prefix: '%PDF-',
    })
  // Chromium's embedded PDF viewer may consume Escape; close the outer dialog explicitly.
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toBeHidden()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'More actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Service acceptance act (PDF)', exact: true }).click()
  await expect(link).toHaveAttribute('download', `complete_work-${number}.pdf`)
  const actDownload = page.waitForEvent('download')
  await link.click()
  expect((await actDownload).suggestedFilename()).toBe(`complete_work-${number}.pdf`)
  await dialog.getByRole('button', { name: 'Share PDF', exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => (window as any).__sharedPdf))
    .toEqual({
      keys: ['files'],
      name: `complete_work-${number}.pdf`,
      type: 'application/pdf',
      prefix: '%PDF-',
    })
  await context.addCookies([
    { name: 'locale', value: 'uk', url: baseURL ?? 'http://127.0.0.1:3100' },
  ])
  const id = new URL(page.url()).pathname.split('/').pop()
  const response = await page.request.get(`/api/protected/services/${id}/pdf`)
  expect(response.ok()).toBe(true)
  const pdf = await pdfContent(await response.body())
  expect(pdf.flat).toContain('Рахунок на оплату')
  expect(pdf.flat).toContain('Invoice download fixture')
  expect(pdf.flat).toContain('До сплати')
})
