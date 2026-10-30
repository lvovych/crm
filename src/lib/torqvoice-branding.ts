/**
 * CRM documents use the workshop's own identity without a vendor mark.
 * Keep this shared provider so PDF exports and customer previews follow the
 * same policy, regardless of document type or licence state.
 */
export async function getTorqvoiceLogoDataUri(): Promise<string | undefined> {
  return undefined
}
