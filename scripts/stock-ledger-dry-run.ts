/** Read-only preflight. Explicit URL required; never falls back to DATABASE_URL. */
import { Client } from 'pg'
import { createHash } from 'node:crypto'
async function main() {
  const url=process.env.LEDGER_PREFLIGHT_DATABASE_URL
  if(!url) throw new Error('Set LEDGER_PREFLIGHT_DATABASE_URL to the restored database copy')
  const db=new Client({connectionString:url})
  await db.connect()
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const counts=await db.query(`SELECT
      (SELECT count(*)::text FROM service_records) AS work_orders,
      (SELECT count(*)::text FROM service_parts) AS parts,
      (SELECT count(*)::text FROM inventory_parts) AS products,
      (SELECT count(*)::text FROM payments) AS payments,
      (SELECT COALESCE(sum(amount::numeric),0)::text FROM payments) AS payment_total,
      (SELECT COALESCE(sum("totalAmount"::numeric),0)::text FROM service_records) AS invoice_total`)
    const negatives=await db.query(`SELECT id,"organizationId",quantity::text FROM inventory_parts WHERE quantity<0 ORDER BY id`)
    const duplicates=await db.query(`SELECT "organizationId","brandId",regexp_replace(upper(normalize(COALESCE("partNumber",''),NFKC)),'[[:space:]./_-]','','g') AS article,array_agg(id ORDER BY id) AS ids FROM inventory_parts WHERE COALESCE("partNumber",'')<>'' GROUP BY 1,2,3 HAVING count(*)>1 ORDER BY 1,2,3`)
    const precision=await db.query(`SELECT id,"organizationId","totalAmount"::text AS amount FROM service_records WHERE "totalAmount"::numeric<>round("totalAmount"::numeric,2) ORDER BY id`)
    const suppliers=await db.query(`SELECT "organizationId",supplier,location,count(*)::text AS products FROM inventory_parts GROUP BY 1,2,3 ORDER BY 1,2,3`)
    const paid=await db.query(`SELECT "organizationId",count(*)::text AS manually_paid FROM service_records WHERE "manuallyPaid"=true GROUP BY 1 ORDER BY 1`)
    const report={counts:counts.rows[0],negativeStock:negatives.rows,ambiguousSku:duplicates.rows,roundingReview:precision.rows,supplierWarehouseMapping:suppliers.rows,historicallyPaid:paid.rows}
    const checksum=createHash('sha256').update(JSON.stringify(report)).digest('hex')
    await db.query('COMMIT')
    process.stdout.write(JSON.stringify({version:1,checksum,...report},null,2)+'\n')
  } finally {await db.end()}
}
main().catch(e=>{console.error(e.message);process.exitCode=1})
