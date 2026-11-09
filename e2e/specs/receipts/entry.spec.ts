import { expect, test, type Page } from '@playwright/test'
import { settle } from '../../support/hydration'
import { receiptDb, receiptFixture } from '../../support/receipt-fixture'
let fixture: Awaited<ReturnType<typeof receiptFixture>>
test.beforeAll(async () => {
  fixture = await receiptFixture()
})
async function choose(page: Page, label: string, name: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click()
  await page.getByLabel(`Пошук: ${label}`).fill(name)
  await page.getByRole('option', { name, exact: true }).click()
}
async function open(page: Page, number: string) {
  await page.goto('/receipts/new')
  await settle(page)
  await choose(page, 'Постачальник', fixture.supplier.name)
  await page.getByLabel('Номер накладної').fill(fixture.prefix + number)
}

test('searches suppliers and auto-fills the single article, preserving edited price', async ({
  page,
}) => {
  await open(page, '-lookup')
  await page.getByLabel('Артикул', { exact: true }).fill(fixture.part.partNumber!)
  await expect(page.getByLabel('Назва', { exact: true })).toHaveValue(fixture.part.name)
  await expect(page.getByRole('combobox', { name: 'Бренд', exact: true })).toContainText(
    fixture.brands[0].name
  )
  await expect(page.getByLabel('Ціна, грн', { exact: true })).toHaveValue('12.3456')
  await expect(page.getByText(/Товар знайдено/)).toBeVisible()
  await expect(page.getByText('Новий артикул', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Створити складську картку/ })).toHaveCount(0)
  await page.getByLabel('Ціна, грн', { exact: true }).fill('9.99')
  await choose(page, 'Постачальник', fixture.supplier.name)
  await expect(page.getByLabel('Ціна, грн', { exact: true })).toHaveValue('9.99')
  await page.getByLabel('Кількість', { exact: true }).fill('2.001')
  await expect(page.getByRole('region', { name: 'Підсумок і проведення' })).toContainText('19,99')
})

test('ambiguous article requires a brand and inactive brands are not offered', async ({ page }) => {
  await open(page, '-ambiguous')
  await page.getByLabel('Артикул', { exact: true }).fill(fixture.prefix + '-SHARED')
  await expect(page.getByText(/Уточніть бренд/)).toBeVisible()
  await expect(page.getByLabel('Назва', { exact: true })).toHaveValue('')
  await page.getByRole('combobox', { name: 'Бренд', exact: true }).click()
  await page.getByLabel('Пошук: Бренд').fill(fixture.brands[2].name)
  await expect(page.getByText('Нічого не знайдено')).toBeVisible()
  await page.getByLabel('Пошук: Бренд').fill(fixture.brands[1].name)
  await page.getByRole('option', { name: fixture.brands[1].name, exact: true }).click()
  await expect(page.getByLabel('Назва', { exact: true })).toHaveValue(fixture.prefix + ' shared 1')
  await expect(page.getByLabel('Ціна, грн', { exact: true })).toHaveValue('21')
})

test('new card is created only on save, draft has zero stock, post and cancel move it once', async ({
  page,
}) => {
  await open(page, '-draft')
  const article = fixture.prefix + '-NEW'
  await page.getByLabel('Артикул', { exact: true }).fill(article)
  await choose(page, 'Бренд', fixture.brands[0].name)
  await page.getByLabel('Назва', { exact: true }).fill(fixture.prefix + ' new filter')
  await page.getByLabel('Кількість', { exact: true }).fill('2.001')
  await page.getByLabel('Ціна, грн', { exact: true }).fill('12.3456')
  const db = await receiptDb()
  try {
    const cards = async () =>
      (
        await db.query<{ id: string; quantity: number }>(
          'select id, quantity from inventory_parts where "organizationId"=$1 and "partNumber"=$2',
          [fixture.organizationId, article]
        )
      ).rows
    expect(await cards()).toHaveLength(0)
    await page.getByRole('button', { name: 'Зберегти чернетку', exact: true }).click()
    await expect(page).toHaveURL(/\/receipts\/[^/?]+$/)
    await expect(
      page.getByRole('heading', { name: 'Накладна № ' + fixture.prefix + '-draft' })
    ).toBeVisible()
    expect(await cards()).toHaveLength(1)
    expect((await cards())[0].quantity).toBe(0)
    await page.getByRole('link', { name: 'Редагувати чернетку' }).click()
    await settle(page)
    await expect(page.getByLabel('Ціна, грн', { exact: true })).toHaveValue('12.3456')
    await page.getByRole('button', { name: 'Зберегти й провести', exact: true }).click()
    await expect(page).toHaveURL(/\/receipts\/[^/?]+$/)
    await expect(page.getByRole('button', { name: 'Скасувати проведення' })).toBeVisible()
    expect(await cards()).toHaveLength(1)
    expect((await cards())[0].quantity).toBe(2.001)
    await page.reload()
    await settle(page)
    expect((await cards())[0].quantity).toBe(2.001)
    await page.getByLabel(/Причина скасування/).fill('E2E reversal')
    await page.getByRole('button', { name: 'Скасувати проведення' }).click()
    await expect(page.getByRole('button', { name: 'Скасувати проведення' })).toHaveCount(0)
    expect((await cards())[0].quantity).toBe(0)
  } finally {
    await db.end()
  }
})

for (const width of [390, 1280, 1600]) {
  test(`entry controls remain usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await open(page, '-layout-' + width)
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Додати позицію' }).click()
    await expect(page.getByLabel('Артикул', { exact: true }).last()).toBeFocused()
    await page.getByRole('button', { name: 'Видалити позицію 3' }).click()
    await expect(page.getByLabel('Артикул', { exact: true })).toHaveCount(4)
    const summary = page.getByRole('region', { name: 'Підсумок і проведення' })
    await summary.scrollIntoViewIfNeeded()
    await expect(summary.getByRole('button', { name: 'Зберегти й провести' })).toBeInViewport()
    expect(
      await page.locator('main').evaluate((el) => el.scrollWidth - el.clientWidth)
    ).toBeLessThanOrEqual(1)
    const buttons = await summary
      .getByRole('button')
      .evaluateAll((elements) => elements.map((el) => el.getBoundingClientRect().toJSON()))
    expect(buttons[0].right <= buttons[1].left || buttons[0].bottom <= buttons[1].top).toBe(true)
    if (width === 1600) {
      const row = page.getByRole('region', { name: 'Позиція 1', exact: true })
      const article = await row.getByLabel('Артикул', { exact: true }).boundingBox()
      const name = await row.getByLabel('Назва', { exact: true }).boundingBox()
      expect(Math.abs(article!.y - name!.y)).toBeLessThan(2)
      expect(name!.width).toBeGreaterThan(article!.width)
    }
  })
}
