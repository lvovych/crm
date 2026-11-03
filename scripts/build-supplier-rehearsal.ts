/** Generate reviewed import SQL. Never executes SQL or connects to a database. */
import { readFile, writeFile } from 'node:fs/promises'
import { prepareApprovedSupplierPlan } from '../src/features/suppliers/Lib/approvedPlan'
import { supplierSnapshotSchema } from '../src/features/suppliers/Lib/preview'

async function main() {
  const [snapshotPath, approvalPath, organizationId, actorId, outputPath, productionChecksum] = process.argv.slice(2)
  if (!snapshotPath || !approvalPath || !organizationId || !actorId || !outputPath)
    throw new Error('Usage: tsx scripts/build-supplier-rehearsal.ts snapshot.json approval.json organizationId actorId output.sql')
  const snapshot = supplierSnapshotSchema.parse(JSON.parse(await readFile(snapshotPath, 'utf8')))
  const approval = JSON.parse(await readFile(approvalPath, 'utf8'))
  const plan = prepareApprovedSupplierPlan(snapshot, approval, organizationId)
  if (!plan.ready) throw new Error(plan.blockers.join('\n'))
  // Production SQL requires explicitly passing the checksum from the successful
  // rehearsal. Source, contacts or approval changes require a new rehearsal.
  const production = productionChecksum !== undefined
  if (production && productionChecksum !== plan.snapshotChecksum)
    throw new Error('Production checksum must match the reviewed rehearsal snapshot')
  const database = production ? 'crm' : 'supplier_rehearsal'
  const status = production ? 'applied' : 'rehearsed'
  const literal = (value: unknown) => "'" + String(value).replaceAll("'", "''") + "'"
  const sql = `\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL standard_conforming_strings = on;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $guard$ BEGIN
  IF current_database() <> ${literal(database)} THEN
    RAISE EXCEPTION 'Wrong target database for this reviewed import';
  END IF;
END $guard$;
SELECT pg_advisory_xact_lock(hashtextextended(${literal('supplier-import:' + organizationId)}, 0));
CREATE TEMP TABLE supplier_rehearsal_input(payload jsonb) ON COMMIT DROP;
INSERT INTO supplier_rehearsal_input VALUES (${literal(JSON.stringify({ plan, snapshot, actorId }))}::jsonb);
DO $apply$
DECLARE
  p jsonb; item jsonb; d jsonb; c jsonb; b jsonb; existing_link record;
  org text; actor text; account text; source_checksum text; cp text; run_id text;
  created integer := 0; skipped integer := 0; linked_total integer;
BEGIN
  SELECT payload INTO p FROM supplier_rehearsal_input;
  org := p->'plan'->>'organizationId'; actor := p->>'actorId';
  account := p->'snapshot'->>'sourceAccountId'; source_checksum := p->'plan'->>'snapshotChecksum';
  IF NOT EXISTS(SELECT 1 FROM organization_members WHERE "organizationId"=org AND "userId"=actor AND role='owner') THEN
    RAISE EXCEPTION 'Expected organization owner is missing';
  END IF;
  IF jsonb_array_length(p->'plan'->'items') <> (p->'plan'->'summary'->>'approved')::integer THEN
    RAISE EXCEPTION 'Approved count mismatch';
  END IF;
  -- Reject unexpected existing directory state; never merge by a fuzzy name match.
  IF EXISTS(SELECT 1 FROM counterparties cp WHERE cp."organizationId"=org AND NOT EXISTS(
    SELECT 1 FROM counterparty_source_links l WHERE l."organizationId"=org AND l."counterpartyId"=cp.id
      AND l.source='carbook' AND l."sourceAccountId"=account AND l.checksum=source_checksum
      AND l."externalSupplierId" IN (SELECT i->>'externalSupplierId' FROM jsonb_array_elements(p->'plan'->'items') i)
  )) THEN RAISE EXCEPTION 'Existing CRM counterparties require a fresh conflict review'; END IF;
  IF EXISTS(SELECT l."counterpartyId" FROM counterparty_source_links l
      WHERE l."organizationId"=org AND l.source='carbook' AND l."sourceAccountId"=account
      GROUP BY l."counterpartyId" HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Separate source cards already share a CRM identity';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p->'plan'->'items') LOOP
    d := item->'data';
    SELECT * INTO existing_link FROM counterparty_source_links l WHERE l."organizationId"=org
      AND l.source='carbook' AND l."sourceAccountId"=account AND l."externalSupplierId"=item->>'externalSupplierId';
    IF FOUND THEN
      IF existing_link.checksum<>source_checksum THEN RAISE EXCEPTION 'Source mapping changed since rehearsal'; END IF;
      skipped := skipped+1;
      CONTINUE;
    END IF;
    cp := gen_random_uuid()::text;
    INSERT INTO counterparties (id,"organizationId",name,"legalName",kind,country,"taxId",address,website,notes,"isArchived","createdById","updatedAt")
    VALUES (cp,org,d->>'name',nullif(d->>'legalName',''),d->>'kind',d->>'country',nullif(d->>'taxId',''),
      nullif(d->>'address',''),nullif(d->>'website',''),nullif(d->>'notes',''),false,actor,CURRENT_TIMESTAMP);
    INSERT INTO supplier_profiles (id,"organizationId","counterpartyId","paymentTermDays","paymentTerms")
    VALUES(gen_random_uuid()::text,org,cp,
      (d->>'paymentTermDays')::integer,nullif(d->>'paymentTerms',''));
    FOR c IN SELECT value FROM jsonb_array_elements(d->'contacts') LOOP
      INSERT INTO counterparty_contacts (id,"organizationId","counterpartyId",name,role,phone,email,"isPrimary")
      VALUES(gen_random_uuid()::text,org,cp,nullif(c->>'name',''),nullif(c->>'role',''),nullif(c->>'phone',''),nullif(c->>'email',''),(c->>'isPrimary')::boolean);
    END LOOP;
    FOR b IN SELECT value FROM jsonb_array_elements(d->'bankAccounts') LOOP
      INSERT INTO counterparty_bank_accounts(id,"organizationId","counterpartyId","accountNumber","bankName",currency,"isPrimary")
      VALUES(gen_random_uuid()::text,org,cp,b->>'accountNumber',nullif(b->>'bankName',''),b->>'currency',(b->>'isPrimary')::boolean);
    END LOOP;
    INSERT INTO counterparty_source_links(id,"organizationId","counterpartyId",source,"sourceAccountId","externalSupplierId",checksum,"snapshotAt")
    VALUES(gen_random_uuid()::text,org,cp,'carbook',account,item->>'externalSupplierId',source_checksum,(p->'snapshot'->>'snapshotAt')::timestamptz);
    -- lastActivityAt stays NULL: the reviewed document is an example, not guaranteed latest activity.
    created := created+1;
  END LOOP;
  SELECT count(*) INTO linked_total FROM counterparty_source_links l WHERE l."organizationId"=org
    AND l.source='carbook' AND l."sourceAccountId"=account AND l.checksum=source_checksum;
  IF linked_total<>(p->'plan'->'summary'->>'approved')::integer THEN RAISE EXCEPTION 'Final identity count mismatch'; END IF;
  INSERT INTO supplier_import_runs(id,"organizationId",source,"sourceAccountId","periodStart","snapshotAt",checksum,status,"createdById",summary)
  VALUES(gen_random_uuid()::text,org,'carbook',account,(p->'snapshot'->>'periodStart')::timestamptz,
    (p->'snapshot'->>'snapshotAt')::timestamptz,source_checksum,${literal(status)},actor,
    jsonb_build_object('approved',linked_total,'approvalChecksum',p->'plan'->>'approvalChecksum','mode',${literal(production ? 'production' : 'copy_only')}))
  ON CONFLICT("organizationId","sourceAccountId",checksum) DO NOTHING;
  SELECT id INTO run_id FROM supplier_import_runs r WHERE r."organizationId"=org AND r."sourceAccountId"=account AND r.checksum=source_checksum;
  INSERT INTO supplier_import_items(id,"organizationId","runId","externalSupplierId",decision,payload,evidence,conflicts)
  SELECT gen_random_uuid()::text,org,run_id,i->>'externalSupplierId','keep_separate',i->'data',i->'evidence',i->'conflicts'
  FROM jsonb_array_elements(p->'plan'->'items') i ON CONFLICT("runId","externalSupplierId") DO NOTHING;
  RAISE NOTICE 'Supplier rehearsal: created=%, skipped=%, total=%',created,skipped,linked_total;
END $apply$;
COMMIT;
`;
  await writeFile(outputPath, sql, { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ approved: plan.summary.approved, snapshotChecksum: plan.snapshotChecksum,
    approvalChecksum: plan.approvalChecksum, mode: production ? 'production' : 'copy_only' }))
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
