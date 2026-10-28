import { randomUUID } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
import { Client } from 'pg'
import { hashPassword, symmetricDecrypt } from 'better-auth/crypto'
import { createOTP } from '@better-auth/utils/otp'

const databaseUrl = process.env.STAGING_DATABASE_URL ?? ''
// Explicit local stacks only: auth staging or the ledger acceptance database.
if (!/^postgresql:\/\/[^@]+@127\.0\.0\.1:(?:55441\/crm_auth_staging|55440\/crm_ledger_test)$/.test(databaseUrl)) {
  throw new Error('Refusing to seed anything except the isolated local auth staging database')
}
const password = `Staging-${randomUUID()}!`
const email = `auth-${randomUUID()}@example.test`
let db: Client
let userId: string

test.beforeAll(async () => {
  db = new Client({ connectionString: databaseUrl })
  await db.connect()
  userId = randomUUID()
  const organizationId = randomUUID()
  await db.query(
    'INSERT INTO users (id,name,email,"emailVerified","updatedAt","termsAcceptedAt") VALUES ($1,$2,$3,true,now(),now())',
    [userId, 'Local Auth Tester', email]
  )
  await db.query(
    'INSERT INTO accounts (id,"accountId","providerId","userId",password,"updatedAt") VALUES ($1,$2,\'credential\',$2,$3,now())',
    [randomUUID(), userId, await hashPassword(password)]
  )
  await db.query('INSERT INTO organizations (id,name,"updatedAt") VALUES ($1,$2,now())', [
    organizationId,
    'Isolated auth staging',
  ])
  await db.query(
    'INSERT INTO organization_members (id,"userId","organizationId",role) VALUES ($1,$2,$3,\'owner\')',
    [randomUUID(), userId, organizationId]
  )
})
test.afterAll(async () => {
  await db?.end()
})

let lastLoginAt = 0
async function login(page: Page, value = password) {
  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, 11_000 - (Date.now() - lastLoginAt)))
  )
  lastLoginAt = Date.now()
  await page.goto('/auth/sign-in')
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(value)
  const result = page.waitForResponse(
    (r) => r.url().endsWith('/sign-in/email') && r.request().method() === 'POST'
  )
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  return result
}
async function signedIn(page: Page) {
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'))
  await page.goto('/settings/account')
  await expect(page.locator('#currentPassword')).toBeVisible()
}
async function logout(page: Page) {
  const previousCookies = (await page.context().cookies())
    .map((c) => `${c.name}=${c.value}`)
    .join('; ')
  const status = await page.evaluate(
    async () =>
      (
        await fetch('/api/public/auth/sign-out', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status
  )
  expect(status).toBe(200)
  const replay = await page.request.get('/api/public/auth/get-session', {
    headers: { Cookie: previousCookies },
  })
  expect(await replay.json()).toBeNull()
  await page.goto('/settings/account')
  await expect(page).toHaveURL(/\/auth\/sign-in/)
}
async function totp() {
  const rows = await db.query('SELECT secret FROM two_factor WHERE "userId"=$1', [userId])
  const secret = await symmetricDecrypt({
    key: process.env.STAGING_AUTH_SECRET!,
    data: rows.rows[0].secret,
  })
  return createOTP(secret, { digits: 6, period: 30 }).totp()
}

test('password, TOTP and recovery codes protect the real browser session', async ({
  page,
  browser,
}) => {
  await test.step('wrong password is refused; valid password opens account settings', async () => {
    expect((await login(page, 'incorrect-password')).status()).toBe(401)
    await expect(page).toHaveURL(/\/auth\/sign-in/)
    expect((await login(page)).status()).toBe(200)
    await signedIn(page)
  })
  let recoveryCode: string
  await test.step('enroll TOTP through the account UI', async () => {
    await page.getByRole('button', { name: 'Enable 2FA', exact: true }).click()
    const dialog = page
      .getByRole('dialog')
      .filter({ has: page.locator('[id="2fa-enable-password"]') })
    await dialog.locator('[id="2fa-enable-password"]').fill(password)
    const enabled = page.waitForResponse((r) => r.url().endsWith('/two-factor/enable'))
    await dialog.getByRole('button', { name: 'Continue', exact: true }).click()
    const response = await enabled
    expect(response.status()).toBe(200)
    recoveryCode = (await response.json()).backupCodes[0]
    await page.getByRole('dialog').getByRole('button', { name: 'Continue', exact: true }).click()
    await page.locator('[id="2fa-verify-code"]').fill(await totp())
    await page.getByRole('dialog').getByRole('button', { name: 'Verify', exact: true }).click()
    await page.getByRole('button', { name: /saved my backup codes/i }).click()
    await expect(page.locator('[id="2fa-disable-password"]')).toBeVisible()
  })
  await test.step('password alone cannot reach protected pages; invalid TOTP is refused', async () => {
    const context = await browser.newContext()
    const fresh = await context.newPage()
    await login(fresh)
    await expect(fresh).toHaveURL(/\/auth\/verify-2fa/)
    await fresh.goto('/settings/account')
    await expect(fresh).toHaveURL(/\/auth\//)
    await fresh.goto('/auth/verify-2fa')
    await fresh.locator('#code').fill('000000')
    const denied = fresh.waitForResponse((r) => r.url().endsWith('/two-factor/verify-totp'))
    await fresh.getByRole('button', { name: 'Verify', exact: true }).click()
    expect((await denied).status()).toBe(401)
    await fresh.locator('#code').fill(await totp())
    await fresh.getByRole('button', { name: 'Verify', exact: true }).click()
    await signedIn(fresh)
    await logout(fresh)
    await context.close()
  })
  await test.step('recovery code works once, then is rejected', async () => {
    for (const expected of [200, 401]) {
      const context = await browser.newContext()
      const fresh = await context.newPage()
      expect((await login(fresh)).status()).toBe(200)
      await expect(fresh).toHaveURL(/\/auth\/verify-2fa/)
      await fresh.getByRole('button', { name: /use a backup code/i }).click()
      await fresh.locator('#code').fill(recoveryCode!)
      const response = fresh.waitForResponse((r) =>
        r.url().endsWith('/two-factor/verify-backup-code')
      )
      await fresh.getByRole('button', { name: 'Verify', exact: true }).click()
      expect((await response).status()).toBe(expected)
      await fresh.goto('/settings/account')
      if (expected === 200) await expect(fresh.locator('#currentPassword')).toBeVisible()
      else await expect(fresh).toHaveURL(/\/auth\//)
      await context.close()
      // Preserve the production authentication rate limiter during repeated logins.
      await new Promise((resolve) => setTimeout(resolve, 11_000))
    }
  })
  await test.step('disable TOTP with password and verify logout revocation', async () => {
    await page.locator('[id="2fa-disable-password"]').fill(password)
    await page.getByRole('button', { name: 'Disable 2FA', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Enable 2FA', exact: true })).toBeVisible()
    await logout(page)
  })
})

test('WebAuthn passkey registers, signs in, renames and is revoked', async ({ page, context }) => {
  const cdp = await context.newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
  await login(page)
  await signedIn(page)
  await test.step('an aborted WebAuthn ceremony leaves registration retryable', async () => {
    await page.evaluate(() => {
      const original = navigator.credentials.create.bind(navigator.credentials)
      navigator.credentials.create = async (options) => {
        const controller = new AbortController()
        controller.abort()
        return original({ ...options, signal: controller.signal })
      }
    })
    await page.getByRole('button', { name: 'Register Passkey', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Register Passkey', exact: true })).toBeEnabled()
    await expect(page.getByText('Registration ceremony was sent an abort signal')).toHaveCount(0)
    await page.evaluate(() => {
      Reflect.deleteProperty(navigator.credentials, 'create')
    })
  })
  await test.step('register a real WebAuthn credential against the server', async () => {
    const verified = page.waitForResponse((r) => r.url().endsWith('/passkey/verify-registration'))
    await page.getByRole('button', { name: 'Register Passkey', exact: true }).click()
    expect((await verified).status()).toBe(200)
    expect(
      (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials
    ).toHaveLength(1)
    await expect(page.getByRole('button', { name: 'Rename Passkey', exact: true })).toBeVisible()
  })
  await test.step('rename and sign in with the credential', async () => {
    await page.getByRole('button', { name: 'Rename Passkey', exact: true }).click()
    await page.locator('#passkey-name').fill('Local staging authenticator')
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Local staging authenticator', { exact: true })).toBeVisible()
    await logout(page)
    await page.getByRole('button', { name: /sign in with passkey/i }).click()
    await signedIn(page)
  })
  await test.step('server rejection cannot masquerade as successful passkey deletion', async () => {
    await page.route('**/api/public/auth/passkey/delete-passkey', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Session expired' }),
      })
    )
    await page.getByRole('button', { name: 'Delete', exact: true }).last().click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.getByText('Failed to delete passkey', { exact: true })).toBeVisible()
    await expect(page.getByText('Local staging authenticator', { exact: true })).toBeVisible()
    await page.unroute('**/api/public/auth/passkey/delete-passkey')
  })
  await test.step('delete and reject a credential that remains on the authenticator', async () => {
    await page.getByRole('button', { name: 'Delete', exact: true }).last().click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.getByText(/no passkeys registered/i)).toBeVisible()
    await logout(page)
    const denied = page.waitForResponse((r) => r.url().endsWith('/passkey/verify-authentication'))
    await page.getByRole('button', { name: /sign in with passkey/i }).click()
    expect([400, 401, 403]).toContain((await denied).status())
    await expect(page).toHaveURL(/\/auth\/sign-in/)
  })
  await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId })
})
