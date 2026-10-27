export const LICENSE_TOKEN_PREFIX = 'tvl1'
export const LICENSE_TOKEN_MAX_AGE_DAYS = 14
export const LICENSE_TOKEN_WARN_AGE_DAYS = 7

export type LicenseTokenPayload = {
  v: 1
  lid: string
  org: string
  plan: string
  expiresAt: string
  issuedAt: string
}

export type LicenseTokenStatus =
  /** no token stored */
  | 'missing'
  /** malformed, bad signature, or minted for another organization */
  | 'invalid'
  /** signature fine, licence term is over */
  | 'expired'
  /** signature fine, but not refreshed within LICENSE_TOKEN_MAX_AGE_DAYS */
  | 'stale'
  | 'valid'

export type LicenseTokenVerification = {
  status: LicenseTokenStatus
  /** present whenever the signature checked out, whatever the status */
  payload: LicenseTokenPayload | null
  /** whole days since the token was signed; null without a payload */
  ageDays: number | null
  /** whole days until the licence term ends; null without a payload */
  daysUntilExpiry: number | null
}
