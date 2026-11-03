-- Run with psql -X -v ON_ERROR_STOP=1 -v org_id=... -v source_account=... -v expected_count=...
-- Read-only verification; contains no supplier data.
BEGIN READ ONLY;
SELECT json_build_object(
  'suppliers', count(*),
  'distinctSourceIds', count(DISTINCT l."externalSupplierId"),
  'distinctCrmIds', count(DISTINCT l."counterpartyId"),
  'active', count(*) FILTER (WHERE NOT c."isArchived"),
  'profiles', count(*) FILTER (WHERE p.id IS NOT NULL),
  'contacts', (SELECT count(*) FROM counterparty_contacts WHERE "organizationId"=:'org_id'),
  'bankAccounts', (SELECT count(*) FROM counterparty_bank_accounts WHERE "organizationId"=:'org_id'),
  'importedItems', (SELECT count(*) FROM supplier_import_items WHERE "organizationId"=:'org_id'),
  'expectedCountMatches', count(*)=:'expected_count'::integer,
  'specializationColumns', (SELECT count(*) FROM information_schema.columns WHERE table_name='supplier_profiles'
      AND column_name IN ('suppliesParts','suppliesServices'))
)
FROM counterparty_source_links l
JOIN counterparties c ON c.id=l."counterpartyId" AND c."organizationId"=l."organizationId"
LEFT JOIN supplier_profiles p ON p."counterpartyId"=c.id AND p."organizationId"=c."organizationId"
WHERE l."organizationId"=:'org_id' AND l.source='carbook' AND l."sourceAccountId"=:'source_account';
COMMIT;
